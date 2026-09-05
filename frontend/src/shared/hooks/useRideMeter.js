import { useEffect, useState } from 'react'
import { buildOfflineFinishPreview } from '@/shared/services/offlineRideFare'
import { newestCheckpoint } from '@/shared/services/rideTrackingCheckpoint'

const SERVER_STALE_MS = 10000

/** O servidor confirma o preço; sem resposta, o aparelho mantém o contador local. */
export function useRideMeter(ride, socket) {
    const [meter, setMeter] = useState(null)

    useEffect(() => {
        if (!ride?._id || ride.status !== 'started') return undefined
        let disposed = false
        let calculating = false
        let awaitingConfirmation = true
        let revision = 0
        let serverDistance = Number(ride.actualDistance) || 0
        let quotedDistance = serverDistance
        let checkpoint = ride.trackingCheckpoint
        let serverAmount = ride.liveFare?.amount ?? null
        let receivedAt = ride.liveFare?.calculatedAt
            ? new Date(ride.liveFare.calculatedAt).getTime() : Date.now()
        let hasFreshConfirmation = Number.isFinite(serverAmount)

        const publish = (value) => {
            if (!disposed) setMeter({ rideId: ride._id, serverDistance, ...value })
        }
        const tick = async () => {
            if (navigator.onLine === false || !socket?.connected
                || serverAmount == null || Date.now() - receivedAt >= SERVER_STALE_MS) {
                awaitingConfirmation = true
            }
            const useLocal = awaitingConfirmation
            if (!useLocal) {
                publish({ amount: serverAmount, distance: serverDistance, local: false })
                return
            }
            if (calculating) return
            calculating = true
            const startedRevision = revision
            try {
                const local = await buildOfflineFinishPreview({ ...ride, actualDistance: serverDistance, trackingCheckpoint: checkpoint }, Date.now())
                // Um cálculo iniciado antes do ACK não pode sobrescrever a confirmação.
                if (disposed || startedRevision !== revision) return
                if (local) {
                    serverDistance = local.syncedDistance
                    checkpoint = newestCheckpoint(checkpoint, local.trackingCheckpoint)
                }
                if (hasFreshConfirmation && local?.pendingPoints === 0 && socket?.connected
                    && local.syncedDistance <= quotedDistance
                    && navigator.onLine !== false && Date.now() - receivedAt < SERVER_STALE_MS) {
                    awaitingConfirmation = false
                    publish({ amount: serverAmount, distance: serverDistance, local: false })
                    return
                }
                publish({
                    amount: local?.amount ?? serverAmount,
                    distance: local?.actualDistance ?? serverDistance,
                    local: true,
                    unavailable: local?.amount == null,
                })
            } catch {
                // Falha de leitura não desmonta a corrida nem zera o valor mostrado.
            } finally {
                calculating = false
            }
        }
        const onLocation = (payload) => {
            if (String(payload?.rideId || '') !== String(ride._id)) return
            const nextCheckpoint = newestCheckpoint(checkpoint, payload.trackingCheckpoint)
            if (payload.trackingCheckpoint && nextCheckpoint !== payload.trackingCheckpoint) return
            revision += 1
            checkpoint = nextCheckpoint
            if (Number.isFinite(payload.actualDistance)) serverDistance = payload.actualDistance
            if (Number.isFinite(payload.liveFare?.amount)) {
                // Um preço do servidor pode confirmar apenas o começo do replay.
                // Recalcular com o restante da fila evita o taxímetro andar para trás.
                awaitingConfirmation = awaitingConfirmation || navigator.onLine === false
                serverAmount = payload.liveFare.amount
                quotedDistance = serverDistance
                receivedAt = Date.now()
                hasFreshConfirmation = true
                if (awaitingConfirmation) void tick()
                else publish({ amount: serverAmount, distance: serverDistance, local: false })
            }
        }
        socket?.on('captain-location-updated', onLocation)
        window.addEventListener('offline', tick)
        window.addEventListener('online', tick)
        void tick()
        const timer = setInterval(tick, 1000)
        return () => {
            disposed = true
            clearInterval(timer)
            socket?.off('captain-location-updated', onLocation)
            window.removeEventListener('offline', tick)
            window.removeEventListener('online', tick)
        }
    }, [ride, socket])

    return meter?.rideId === ride?._id && ride?.status === 'started' ? meter : null
}
