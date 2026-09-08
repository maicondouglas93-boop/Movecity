import api from '@/shared/services/axios'
import { db } from '@/shared/services/db'
import { getAccessToken, getSessionOwnerId } from '@/shared/services/session'
import { clearSavedDriverRide } from '@/shared/services/driverRecoveryStore'
import { acknowledgeTrackingPoint } from '@/shared/services/rideTrackingCheckpoint'
import { withHardTimeout } from '@/shared/utils/hardTimeout'
import { hasFinalizationTarget, MISSING_RIDE_MESSAGE } from '@/shared/utils/rideIdentity'
import { rideFinalizationError } from '@/shared/utils/rideFinalizationError'
import { canRetryFinalization } from '@/shared/utils/pendingFinalization'

// P1.2 da auditoria de concorrência (2026-08-02): antes, a fila offline reexecutava
// ações via `socket.emit(action.type, ...)` — mas o backend nunca teve handler de
// socket pra 'accept-ride'/'start-ride'/'end-ride'/'confirm-payment'/'update-ride-status'.
// Cada ação era emitida no vazio e IMEDIATAMENTE apagada da fila, sem nenhuma confirmação
// real (item O1 da auditoria: "a fila offline emite no vazio e apaga a ação"). Este módulo
// reexecuta via HTTP — os mesmos endpoints REST que o app já chama quando está online —
// e só remove da fila depois de uma resposta 2xx de verdade.
const MAX_ATTEMPTS = 5
let replayPromise = null
let endRideEnqueuePromise = null

const ACTION_LABELS = {
    'accept-ride': 'aceitar a corrida',
    'start-ride': 'iniciar a corrida',
    'update-ride-status': 'atualizar o status da corrida',
    'end-ride': 'finalizar a corrida',
    'confirm-payment': 'confirmar o pagamento',
    // Auditoria PWA (2026-08-03, M3): antes só o app do motorista tinha rede de
    // segurança offline — cancelar corrida e confirmar pagamento do lado do
    // passageiro se perdiam de vez numa falha de rede bem na hora do clique.
    'cancel-ride': 'cancelar a corrida',
    'pay-ride': 'confirmar o pagamento',
}

export function actionLabel(type) {
    return ACTION_LABELS[type] || 'sincronizar uma ação pendente'
}

// Cada tipo de ação pertence a um lado (motorista ou passageiro) — o token tem que
// bater com quem realmente disparou a ação, não pode ser sempre captain-token.
const CAPTAIN_ACTION_TYPES = new Set(['accept-ride', 'start-ride', 'update-ride-status', 'end-ride', 'confirm-payment'])

function buildRequestConfig(action) {
    const baseURL = import.meta.env.VITE_BASE_URL
    const ownerKind = CAPTAIN_ACTION_TYPES.has(action.type) ? 'captain' : 'user'
    const headers = { Authorization: `Bearer ${getAccessToken(ownerKind)}` }
    const { payload } = action

    switch (action.type) {
        case 'accept-ride':
            return { method: 'post', url: `${baseURL}/rides/${payload.rideId}/accept`, data: {}, headers }
        // `occurredAt` viaja como foi capturado no enqueue (o toque real do motorista) e
        // nunca é regerado aqui: recalcular na sincronização é exatamente o atraso que
        // este campo existe pra excluir da cobrança.
        case 'start-ride':
            return {
                method: 'get',
                url: `${baseURL}/rides/start-ride`,
                params: {
                    rideId: payload.rideId,
                    ...(payload.occurredAt != null ? { occurredAt: payload.occurredAt } : {}),
                },
                headers,
            }
        // 'update-ride-status' (inclui 'arrived') NÃO manda occurredAt de propósito:
        // um arrivedAt mais antigo AUMENTA a espera cobrada, então seria uma alavanca
        // de inflação vinda do cliente. O caso que importava — chegada online + embarque
        // offline — já é corrigido pelo occurredAt do start-ride.
        case 'update-ride-status':
            return { method: 'post', url: `${baseURL}/rides/update-status`, data: { rideId: payload.rideId, status: payload.status }, headers }
        case 'end-ride':
            return {
                method: 'post',
                url: `${baseURL}/rides/end-ride`,
                data: {
                    rideId: payload.rideId,
                    // Sempre envia o instante do toque, mesmo quando não havia um fix GPS
                    // atual. Sem isso, o atraso até a reconexão virava tempo de corrida.
                    ...(payload.finishTimestamp != null ? {
                        finishTimestamp: payload.finishTimestamp,
                    } : {}),
                    ...(payload.finishLat != null && payload.finishLng != null ? {
                        finishLat: payload.finishLat,
                        finishLng: payload.finishLng,
                        finishAccuracy: payload.finishAccuracy ?? null,
                        ...(payload.finishLocationTimestamp != null ? {
                            finishLocationTimestamp: payload.finishLocationTimestamp,
                        } : {}),
                    } : {}),
                },
                headers,
            }
        case 'confirm-payment':
            return { method: 'post', url: `${baseURL}/rides/confirm-payment`, data: { rideId: payload.rideId }, headers }
        case 'cancel-ride':
            return { method: 'post', url: `${baseURL}/rides/cancel`, data: { rideId: payload.rideId }, headers }
        case 'pay-ride':
            return { method: 'post', url: `${baseURL}/rides/pay`, data: { rideId: payload.rideId }, headers }
        default:
            return null
    }
}

async function moveToFailedAndRemove(action, reason) {
    await db.failedActions.add({
        type: action.type,
        rideId: action.rideId,
        payload: action.payload,
        timestamp: action.timestamp,
        failedAt: Date.now(),
        reason
    })
    await db.offlineActions.delete(action.id)
}

export async function enqueueOfflineAction({ type, rideId, payload, rideSnapshot }) {
    const entry = { type, rideId, payload, timestamp: Date.now(), attempts: 0 }
    if (type !== 'end-ride') {
        if (type === 'start-ride' || type === 'update-ride-status') {
            if (!hasFinalizationTarget(entry)) throw new Error('Corrida inválida para salvar esta etapa.')
            entry.ownerId = getSessionOwnerId('captain')
            entry.apiBase = import.meta.env.VITE_BASE_URL || ''
            if (rideSnapshot) entry.rideSnapshot = rideSnapshot
        }
        return db.offlineActions.add(entry)
    }
    if (!hasFinalizationTarget(entry)) throw new Error(MISSING_RIDE_MESSAGE)
    const ownerId = getSessionOwnerId('captain')
    entry.ownerId = ownerId
    entry.apiBase = import.meta.env.VITE_BASE_URL || ''
    if (rideSnapshot) entry.rideSnapshot = rideSnapshot

    // Finalizar e tocar de novo, ou receber simultaneamente o fallback do timeout e o
    // evento offline, nunca pode criar duas finalizações para a mesma corrida. O lock
    // cobre chamadas concorrentes nesta execução; a varredura cobre reinício do app.
    const previous = endRideEnqueuePromise
    const current = (async () => {
        if (previous) await previous.catch(() => {})

        const pending = await db.offlineActions.toArray()
        const existing = pending.find((action) => (
            action.type === 'end-ride' && String(action.rideId) === String(rideId)
        ))
        if (!existing) return db.offlineActions.add(entry)

        // Mantém o primeiro toque como fim real, mas aproveita um fix GPS mais novo de
        // um segundo toque. Isso melhora a chance de sincronizar sem cobrar tempo extra.
        const oldFinish = Number(existing.payload?.finishTimestamp)
        const newFinish = Number(payload?.finishTimestamp)
        const validFinishes = [oldFinish, newFinish].filter(Number.isFinite)
        const mergedPayload = {
            ...existing.payload,
            ...payload,
            ...(validFinishes.length > 0 ? { finishTimestamp: Math.min(...validFinishes) } : {}),
        }
        await db.offlineActions.update(existing.id, { payload: mergedPayload })
        return existing.id
    })()

    endRideEnqueuePromise = current
    try {
        const id = await current
        clearSavedDriverRide(ownerId, rideId)
        return id
    } finally {
        if (endRideEnqueuePromise === current) endRideEnqueuePromise = null
    }
}

/**
 * Esta corrida já foi finalizada pelo motorista, faltando só sincronizar?
 *
 * Quando a internet volta, a reconciliação com o servidor (GET /rides/captain-current)
 * e o replay da fila disparam no MESMO evento 'online'. O GET é muito mais rápido que
 * o replay (que ainda drena o GPS antes de reenviar), então o servidor responde com a
 * corrida ainda `started` e a tela ressuscita uma corrida que o motorista já fechou.
 *
 * A fila é a verdade local nesse intervalo: enquanto houver um 'end-ride' pendente
 * para a corrida, o estado do servidor está sabidamente atrasado e não deve reabrir
 * nada na tela.
 */
export async function hasPendingFinalization(rideId, { throwOnError = false } = {}) {
    if (!rideId) return false
    try {
        // Compara com String() dos dois lados: um _id que chegue como ObjectId/número
        // não bateria numa busca por índice e a checagem falharia em silêncio — que é
        // exatamente o modo de falha que este guarda existe para evitar. A fila tem
        // poucas ações pendentes, então varrer é barato.
        const pending = await db.offlineActions.toArray()
        return pending.some((action) => (
            action.type === 'end-ride' && String(action.rideId) === String(rideId)
        ))
    } catch (err) {
        console.error('[OfflineQueue] falha ao consultar finalização pendente:', err)
        if (throwOnError) throw err
        return false
    }
}

// Auditoria PWA (2026-08-03): antes vivia em SocketContext.jsx, disparado direto no
// 'connect' do socket — mas 'join' agora exige token e faz verificações assíncronas no
// backend antes de aceitar `update-location-captain` (C1/C2). Emitir a localização
// enfileirada no mesmo instante do 'connect', sem esperar o join confirmar, corria o
// risco de chegar ANTES da identidade autenticada existir no socket e ser rejeitada à
// toa. Por isso só é chamado depois do ack de sucesso do 'join' (ver CaptainHome.jsx /
// CaptainRiding.jsx).
const LOCATION_ACK_TIMEOUT_MS = 10_000
let locationFlushPromise = null

function emitLocationWithAck(socket, point) {
    return new Promise((resolve, reject) => {
        if (!socket?.connected) {
            reject(new Error('Socket desconectado durante sincronização GPS'))
            return
        }

        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            reject(new Error('Confirmação do ponto GPS expirou'))
        }, LOCATION_ACK_TIMEOUT_MS)

        socket.emit('update-location-captain', {
            pointId: point.pointId,
            ...(point.rideId ? { rideId: point.rideId } : {}),
            location: {
                ltd: point.lat,
                lng: point.lng,
                ...(Number.isFinite(point.accuracy) ? { accuracy: point.accuracy } : {}),
                timestamp: point.capturedAt,
            }
        }, (response) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            if (!response?.ok) {
                reject(new Error(response?.code || 'Ponto GPS não confirmado'))
                return
            }
            resolve(response)
        })
    })
}

async function runLocationFlush(socket, { rideId } = {}) {
    const all = await db.driverLocations.orderBy('capturedAt').toArray()
    const locations = rideId
        ? all.filter(point => String(point.rideId || '') === String(rideId))
        : all

    for (const point of locations) {
        const response = await emitLocationWithAck(socket, point)
        // Só remove depois do ack do backend. Se a resposta se perder, o ponto fica e
        // o pointId garante que o replay não conte o segmento novamente.
        await acknowledgeTrackingPoint(point, response)
    }

    return { synced: locations.length }
}

export async function flushQueuedLocations(socket, options = {}) {
    // Encadeia em vez de "esperar e então começar": vários chamadores em espera
    // retomavam juntos, cada um seguia para iniciar a própria sincronização, e todos
    // liam a mesma fila e emitiam os mesmos pontos. A idempotência do servidor absorvia
    // financeiramente, mas gastava rede e bateria à toa. Aqui cada chamada se enfileira
    // depois da anterior, e o `catch` impede que uma falha derrube as seguintes.
    const previous = locationFlushPromise
    const current = (async () => {
        if (previous) {
            await previous.catch(() => {})
        }
        return runLocationFlush(socket, options)
    })()

    locationFlushPromise = current
    try {
        return await current
    } finally {
        // Só limpa se ninguém encadeou depois — senão apagaria a corrente em andamento.
        if (locationFlushPromise === current) locationFlushPromise = null
    }
}

// Processa a fila em ordem cronológica, sequencialmente (nunca em paralelo — uma ação
// de "finalizar corrida" reexecutada antes de "iniciar corrida" ter sido confirmada
// corromperia a máquina de estados do lado do servidor). Para no primeiro erro
// retentável (rede/5xx) pra não furar essa ordem; erros definitivos (409/4xx) são
// removidos e o processamento segue pras ações seguintes.
async function runOfflineReplay({ socket, onResolved, onAlreadyApplied, onPermanentFailure, onRetryLater, targetActionId } = {}) {
    let actions = await db.offlineActions.orderBy('timestamp').toArray()
    if (targetActionId != null) {
        const index = actions.findIndex(action => action.id === targetActionId)
        if (index < 0) return
        const target = actions[index]
        const owner = getSessionOwnerId('captain')
        if (!canRetryFinalization(target, owner)) throw new Error('Esta pendência precisa de verificação pelo suporte.')
        // Preservar chegada/início anteriores do mesmo serviço, sem disparar outras
        // viagens nem pagamentos. A fila global e a tentativa manual usam o mesmo lock.
        actions = actions.slice(0, index + 1).filter(action => action.rideId === target.rideId)
        if (actions.some(action => !['start-ride', 'update-ride-status', 'end-ride'].includes(action.type)
            || !hasFinalizationTarget(action) || action.ownerId !== owner || action.retryBlocked
            || (action.apiBase != null && action.apiBase !== (import.meta.env.VITE_BASE_URL || '')))) {
            throw new Error('Há etapas anteriores que precisam de verificação pelo suporte.')
        }
    }

    for (const action of actions) {
        const requestOwner = getSessionOwnerId('captain')
        if (CAPTAIN_ACTION_TYPES.has(action.type) && (
            (action.ownerId && action.ownerId !== getSessionOwnerId('captain'))
            || (action.apiBase != null && action.apiBase !== (import.meta.env.VITE_BASE_URL || ''))
        )) continue
        // Versões anteriores podiam gravar um toque vindo de uma tela sem corrida.
        // Preservar o registro para diagnóstico, sem POST inválido, drenagem de GPS
        // de outras viagens ou bloqueio das próximas finalizações legítimas.
        if (action.type === 'end-ride' && !hasFinalizationTarget(action)) continue
        if (action.type === 'end-ride' && action.retryBlocked) continue
        if (action.type === 'end-ride') {
            try {
                await flushQueuedLocations(socket, { rideId: action.rideId })
            } catch (err) {
                if (requestOwner !== getSessionOwnerId('captain')) break
                await db.offlineActions.update(action.id, {
                    lastAttemptAt: Date.now(), lastHttpStatus: null,
                    lastError: 'Os pontos GPS desta corrida ainda não sincronizaram. Confira a conexão e tente novamente.',
                    attempts: (action.attempts || 0) + 1,
                })
                onRetryLater?.(action, err)
                break
            }
            const leftover = (await db.driverLocations.orderBy('capturedAt').toArray())
                .filter((point) => String(point.rideId || '') === String(action.rideId))
            if (leftover.length > 0) {
                onRetryLater?.(action, new Error('GPS da corrida ainda não sincronizou'))
                break
            }
        }

        const config = buildRequestConfig(action)
        if (!config) {
            await moveToFailedAndRemove(action, 'Tipo de ação desconhecido (versão antiga da fila)')
            onPermanentFailure?.(action, { message: 'Tipo de ação desconhecido' })
            continue
        }

        try {
            if (CAPTAIN_ACTION_TYPES.has(action.type) && requestOwner !== getSessionOwnerId('captain')) break
            if (action.type === 'end-ride') await db.offlineActions.update(action.id, { lastAttemptAt: Date.now() })
            // Fase 1 (C1, 2026-08-05): via instância configurada — timeout de 10s,
            // withCredentials e refresh automático em 401. O header Authorization
            // explícito de buildRequestConfig é respeitado pelo interceptor (o token
            // tem que bater com o dono da ação, não com o fallback user>captain).
            // Falha de rede continua sem resposta HTTP → cai no branch retentável
            // abaixo, sem deslogar ninguém.
            // O CapacitorHttp pode ignorar o timeout do Axios. Sem um teto no JS, uma
            // única tentativa sem resposta bloqueia todas as ações seguintes para sempre.
            const response = await withHardTimeout(api(config))
            if (CAPTAIN_ACTION_TYPES.has(action.type) && requestOwner !== getSessionOwnerId('captain')) break
            if (action.type === 'end-ride' && (response.data?._id !== action.rideId || response.data?.status !== 'finished')) {
                throw new Error('O servidor respondeu sem confirmar o encerramento desta corrida.')
            }
            await db.offlineActions.delete(action.id)
            onResolved?.(action, response)
        } catch (err) {
            if (CAPTAIN_ACTION_TYPES.has(action.type) && requestOwner !== getSessionOwnerId('captain')) break
            const status = err.response?.status
            const isPerformedWork = action.type === 'end-ride'

            if (status === 409 && !isPerformedWork) {
                // O servidor está dizendo "isso já foi feito" — normalmente porque uma
                // tentativa anterior desta mesma ação teve sucesso, mas a confirmação não
                // chegou até o cliente (rede caiu bem na resposta). Retentar pra sempre
                // não ajudaria: o 409 já É a confirmação de que o efeito existe.
                //
                // end-ride é diferente: finalização em processamento também responde
                // 409, sem confirmar que terminou. A rota é idempotente e devolve 200 se
                // já finalizou, portanto só esse 200 permite retirar a ação com segurança.
                await db.offlineActions.delete(action.id)
                onAlreadyApplied?.(action, err)
                continue
            }

            // 'end-ride' é a única ação que representa trabalho JÁ EXECUTADO: a viagem
            // aconteceu. Descartá-la num 4xx significa nunca pagar o motorista por ela, e
            // vários 400 desta rota são ambientais — GPS que ainda não terminou de
            // sincronizar, tarifa indisponível no instante, localização considerada
            // velha. Esses passam numa tentativa seguinte, então ela entra no contador de
            // retentativas em vez de morrer no primeiro erro. 403/404 ficam visíveis
            // para o suporte, com repetição bloqueada, sem apagar trabalho executado.
            const worthRetrying = isPerformedWork

            if (status && status >= 400 && status < 500 && !worthRetrying) {
                // Erro do próprio pedido (corrida não existe mais, estado inválido, etc.) —
                // tentar de novo não muda o resultado.
                await moveToFailedAndRemove(action, err.response?.data?.message || err.message);
                onPermanentFailure?.(action, err)
                continue
            }

            // 5xx ou falha de rede: pode ser transitório.
            const attempts = (action.attempts || 0) + 1
            if (attempts >= MAX_ATTEMPTS && !isPerformedWork) {
                await moveToFailedAndRemove(action, err.response?.data?.message || err.message || 'Falha após múltiplas tentativas');
                onPermanentFailure?.(action, err)
                continue
            }

            await db.offlineActions.update(action.id, {
                attempts,
                ...(isPerformedWork ? {
                    lastHttpStatus: status ?? null,
                    retryBlocked: status === 404 || status === 403,
                    lastError: rideFinalizationError(err, status
                        ? 'O servidor não confirmou a finalização. Tente novamente ou consulte o suporte.'
                        : 'Sem confirmação do servidor. Confira a conexão e tente sincronizar novamente.'),
                } : {}),
            })
            onRetryLater?.(action, err)
            break // preserva a ordem — não tenta as próximas ações nesta rodada
        }
    }
}

export async function replayOfflineActions(options = {}) {
    // Socket connect, evento `online` e o join autenticado podem disparar juntos. Em vez
    // de três processadores lerem e enviarem o mesmo item, cada rodada espera a anterior.
    const previous = replayPromise
    const current = (async () => {
        if (previous) await previous.catch(() => {})
        return runOfflineReplay(options)
    })()

    replayPromise = current
    try {
        return await current
    } finally {
        if (replayPromise === current) replayPromise = null
    }
}

export async function retryPendingFinalization(actionId, { socket } = {}) {
    if (navigator.onLine === false) throw new Error('Conecte-se à internet para tentar sincronizar. O pedido continua salvo.')
    const owner = getSessionOwnerId('captain')
    const action = await db.offlineActions.get(actionId)
    if (!action) return { status: 'resolved' }
    if (!canRetryFinalization(action, owner)) throw new Error('Esta pendência precisa de verificação pelo suporte.')
    await replayOfflineActions({ socket, targetActionId: actionId })
    if (getSessionOwnerId('captain') !== owner) throw new Error('A conta mudou. Abra Corridas novamente.')
    return { status: await db.offlineActions.get(actionId) ? 'pending' : 'resolved' }
}
