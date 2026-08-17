import api from '@/shared/services/axios'
import { db } from '@/shared/services/db'
import { getAccessToken } from '@/shared/services/session'

// P1.2 da auditoria de concorrência (2026-08-02): antes, a fila offline reexecutava
// ações via `socket.emit(action.type, ...)` — mas o backend nunca teve handler de
// socket pra 'accept-ride'/'start-ride'/'end-ride'/'confirm-payment'/'update-ride-status'.
// Cada ação era emitida no vazio e IMEDIATAMENTE apagada da fila, sem nenhuma confirmação
// real (item O1 da auditoria: "a fila offline emite no vazio e apaga a ação"). Este módulo
// reexecuta via HTTP — os mesmos endpoints REST que o app já chama quando está online —
// e só remove da fila depois de uma resposta 2xx de verdade.
const MAX_ATTEMPTS = 5

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
        case 'start-ride':
            return { method: 'get', url: `${baseURL}/rides/start-ride`, params: { rideId: payload.rideId, otp: payload.otp }, headers }
        case 'update-ride-status':
            return { method: 'post', url: `${baseURL}/rides/update-status`, data: { rideId: payload.rideId, status: payload.status }, headers }
        case 'end-ride':
            return {
                method: 'post',
                url: `${baseURL}/rides/end-ride`,
                data: {
                    rideId: payload.rideId,
                    ...(payload.finishLat != null && payload.finishLng != null ? {
                        finishLat: payload.finishLat,
                        finishLng: payload.finishLng,
                        finishAccuracy: payload.finishAccuracy ?? null,
                        // Preserva o instante real em que o motorista tocou "Finalizar"
                        // (capturado no enqueue, offline) — Date.now() aqui recalcularia o
                        // horário só na hora de sincronizar, que é exatamente o atraso que
                        // esse timestamp existe pra excluir da corrida.
                        finishTimestamp: payload.finishTimestamp ?? Date.now(),
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

export async function enqueueOfflineAction({ type, rideId, payload }) {
    await db.offlineActions.add({ type, rideId, payload, timestamp: Date.now(), attempts: 0 })
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
        await emitLocationWithAck(socket, point)
        // Só remove depois do ack do backend. Se a resposta se perder, o ponto fica e
        // o pointId garante que o replay não conte o segmento novamente.
        await db.driverLocations.delete(point.id)
    }

    return { synced: locations.length }
}

export async function flushQueuedLocations(socket, options = {}) {
    if (locationFlushPromise) await locationFlushPromise
    locationFlushPromise = runLocationFlush(socket, options)
    try {
        return await locationFlushPromise
    } finally {
        locationFlushPromise = null
    }
}

// Processa a fila em ordem cronológica, sequencialmente (nunca em paralelo — uma ação
// de "finalizar corrida" reexecutada antes de "iniciar corrida" ter sido confirmada
// corromperia a máquina de estados do lado do servidor). Para no primeiro erro
// retentável (rede/5xx) pra não furar essa ordem; erros definitivos (409/4xx) são
// removidos e o processamento segue pras ações seguintes.
export async function replayOfflineActions({ socket, onResolved, onAlreadyApplied, onPermanentFailure, onRetryLater } = {}) {
    const actions = await db.offlineActions.orderBy('timestamp').toArray()

    for (const action of actions) {
        if (action.type === 'end-ride' && socket) {
            try {
                await flushQueuedLocations(socket, { rideId: action.rideId })
            } catch (err) {
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
            // Fase 1 (C1, 2026-08-05): via instância configurada — timeout de 10s,
            // withCredentials e refresh automático em 401. O header Authorization
            // explícito de buildRequestConfig é respeitado pelo interceptor (o token
            // tem que bater com o dono da ação, não com o fallback user>captain).
            // Falha de rede continua sem resposta HTTP → cai no branch retentável
            // abaixo, sem deslogar ninguém.
            const response = await api(config)
            await db.offlineActions.delete(action.id)
            onResolved?.(action, response)
        } catch (err) {
            const status = err.response?.status

            if (status === 409) {
                // O servidor está dizendo "isso já foi feito" — normalmente porque uma
                // tentativa anterior desta mesma ação teve sucesso, mas a confirmação não
                // chegou até o cliente (rede caiu bem na resposta). Retentar pra sempre
                // não ajudaria: o 409 já É a confirmação de que o efeito existe.
                await db.offlineActions.delete(action.id)
                onAlreadyApplied?.(action, err)
                continue
            }

            if (status && status >= 400 && status < 500) {
                // Erro do próprio pedido (corrida não existe mais, OTP inválido, etc.) —
                // tentar de novo não muda o resultado.
                await moveToFailedAndRemove(action, err.response?.data?.message || err.message);
                onPermanentFailure?.(action, err)
                continue
            }

            // 5xx ou falha de rede: pode ser transitório.
            const attempts = (action.attempts || 0) + 1
            if (attempts >= MAX_ATTEMPTS) {
                await moveToFailedAndRemove(action, err.response?.data?.message || err.message || 'Falha após múltiplas tentativas');
                onPermanentFailure?.(action, err)
                continue
            }

            await db.offlineActions.update(action.id, { attempts })
            onRetryLater?.(action, err)
            break // preserva a ordem — não tenta as próximas ações nesta rodada
        }
    }
}
