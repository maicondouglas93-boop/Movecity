import axios from 'axios'
import { db } from '@/services/db'

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
}

export function actionLabel(type) {
    return ACTION_LABELS[type] || 'sincronizar uma ação pendente'
}

// Todas as ações hoje enfileiradas são do app do motorista — usam captain-token.
function buildRequestConfig(action) {
    const baseURL = import.meta.env.VITE_BASE_URL
    const headers = { Authorization: `Bearer ${localStorage.getItem('captain-token')}` }
    const { payload } = action

    switch (action.type) {
        case 'accept-ride':
            return { method: 'post', url: `${baseURL}/rides/${payload.rideId}/accept`, data: {}, headers }
        case 'start-ride':
            return { method: 'get', url: `${baseURL}/rides/start-ride`, params: { rideId: payload.rideId, otp: payload.otp }, headers }
        case 'update-ride-status':
            return { method: 'post', url: `${baseURL}/rides/update-status`, data: { rideId: payload.rideId, status: payload.status }, headers }
        case 'end-ride':
            return { method: 'post', url: `${baseURL}/rides/end-ride`, data: { rideId: payload.rideId }, headers }
        case 'confirm-payment':
            return { method: 'post', url: `${baseURL}/rides/confirm-payment`, data: { rideId: payload.rideId }, headers }
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
export async function flushQueuedLocations(socket) {
    const locations = await db.driverLocations.toArray()
    if (locations.length === 0) return
    const lastLoc = locations[locations.length - 1]
    socket.emit('update-location-captain', { location: { ltd: lastLoc.lat, lng: lastLoc.lng } })
    await db.driverLocations.clear()
}

// Processa a fila em ordem cronológica, sequencialmente (nunca em paralelo — uma ação
// de "finalizar corrida" reexecutada antes de "iniciar corrida" ter sido confirmada
// corromperia a máquina de estados do lado do servidor). Para no primeiro erro
// retentável (rede/5xx) pra não furar essa ordem; erros definitivos (409/4xx) são
// removidos e o processamento segue pras ações seguintes.
export async function replayOfflineActions({ onResolved, onAlreadyApplied, onPermanentFailure, onRetryLater } = {}) {
    const actions = await db.offlineActions.orderBy('timestamp').toArray()

    for (const action of actions) {
        const config = buildRequestConfig(action)
        if (!config) {
            await moveToFailedAndRemove(action, 'Tipo de ação desconhecido (versão antiga da fila)')
            onPermanentFailure?.(action, { message: 'Tipo de ação desconhecido' })
            continue
        }

        try {
            const response = await axios(config)
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
