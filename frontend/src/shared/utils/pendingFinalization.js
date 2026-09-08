import { hasFinalizationTarget, hasRideId } from '@/shared/utils/rideIdentity'

export function canRetryFinalization(action, ownerId) {
    return action?.type === 'end-ride' && hasFinalizationTarget(action) && Boolean(ownerId)
        && action.ownerId === ownerId && !action.retryBlocked
        && (action.apiBase == null || action.apiBase === (import.meta.env.VITE_BASE_URL || ''))
        && Number.isFinite(Number(action.payload?.finishTimestamp)) && Number(action.payload.finishTimestamp) > 0
}

export function pendingReference(action) {
    const safeId = hasRideId(action?.rideId) && /^[a-zA-Z0-9_-]{1,64}$/.test(action.rideId)
    return `Local ${Number.isSafeInteger(action?.id) ? action.id : 'sem número'}${safeId ? ` · Corrida ${action.rideId}` : ' · Corrida sem identificação'}`
}

export function pendingTime(value) {
    const time = value == null ? NaN : new Date(value).getTime()
    return Number.isFinite(time) ? new Date(time).toLocaleString('pt-BR') : 'Não registrado'
}

export function pendingSupportMessage(action) {
    // Sem passageiro, rota, valores, GPS, token ou mensagem bruta do servidor.
    return [
        'Sou motorista do MoveCity e preciso de ajuda com uma finalização pendente.',
        `Referência: ${pendingReference(action)}.`,
        `Toque em finalizar: ${pendingTime(action?.payload?.finishTimestamp)}.`,
        `Salvo no aparelho: ${pendingTime(action?.timestamp)}.`,
        `Tentativas sem confirmação: ${Number(action?.attempts) || 0}.`,
        `Última tentativa: ${pendingTime(action?.lastAttemptAt)}.`,
        `Resposta HTTP: ${Number.isInteger(action?.lastHttpStatus) ? action.lastHttpStatus : 'não registrada'}.`,
        'Verifique o mesmo ID no sistema, sem criar outra corrida ou cobrança.',
    ].join('\n')
}
