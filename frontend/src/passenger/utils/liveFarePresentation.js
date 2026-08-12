export const LIVE_FARE_STALE_AFTER_MS = 45_000

export function normalizeLiveFare(snapshot, receivedAt = Date.now()) {
    if (!snapshot || !Number.isFinite(Number(snapshot.amount))) return null

    const calculatedAtMs = new Date(snapshot.calculatedAt || receivedAt).getTime()
    return {
        amount: Number(snapshot.amount),
        actualDistance: Number.isFinite(Number(snapshot.actualDistance))
            ? Number(snapshot.actualDistance)
            : null,
        calculatedAt: Number.isFinite(calculatedAtMs) ? calculatedAtMs : receivedAt,
    }
}

export function describeLiveFareFreshness({ updatedAt, now = Date.now(), online = true }) {
    if (!online) return { label: 'Sem conexão · último valor conhecido', stale: true }
    if (!updatedAt) return { label: 'Aguardando atualização em tempo real', stale: true }

    const ageMs = Math.max(0, now - updatedAt)
    const ageSeconds = Math.floor(ageMs / 1000)
    if (ageMs >= LIVE_FARE_STALE_AFTER_MS) {
        return { label: `Valor desatualizado há ${ageSeconds}s`, stale: true }
    }
    if (ageSeconds < 5) return { label: 'Atualizado agora', stale: false }
    return { label: `Atualizado há ${ageSeconds}s`, stale: false }
}

export function calculateFareDifference(currentAmount, estimatedAmount) {
    const current = Number(currentAmount)
    const estimate = Number(estimatedAmount)
    if (!Number.isFinite(current) || !Number.isFinite(estimate)) return null
    return current - estimate
}
