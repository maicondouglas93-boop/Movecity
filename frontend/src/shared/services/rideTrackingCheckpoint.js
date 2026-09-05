import { db } from '@/shared/services/db'

export function validCheckpoint(value) {
    if (!value || !Number.isFinite(value.actualDistance) || value.actualDistance < 0) return false
    if (value.lastLocation == null) return value.lastLocationAt == null
    const { lat, lng } = value.lastLocation
    return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180
        && Number.isFinite(new Date(value.lastLocationAt).getTime()) && value.lastLocationAt != null
}

export function newestCheckpoint(previous, incoming) {
    if (!validCheckpoint(incoming)) return validCheckpoint(previous) ? previous : null
    if (!validCheckpoint(previous)) return incoming
    const previousAt = previous.lastLocationAt ? new Date(previous.lastLocationAt).getTime() : 0
    const incomingAt = incoming.lastLocationAt ? new Date(incoming.lastLocationAt).getTime() : 0
    return incomingAt >= previousAt && incoming.actualDistance >= previous.actualDistance ? incoming : previous
}

export async function acknowledgeTrackingPoint(point, response) {
    if (response.pointId && response.pointId !== point.pointId) throw new Error('Confirmação GPS de outro ponto')
    await db.transaction('rw', db.driverLocations, db.rideTracking, async () => {
        if (point.rideId && validCheckpoint(response.trackingCheckpoint)) {
            const rideId = String(point.rideId)
            const previous = await db.rideTracking.get(rideId)
            const checkpoint = newestCheckpoint(previous, response.trackingCheckpoint)
            await db.rideTracking.put({ ...checkpoint, rideId })
        }
        // Se o armazenamento falhar, a transação aborta: o ponto permanece para replay.
        await db.driverLocations.delete(point.id)
    })
}

export function readTrackingState(ride) {
    return db.transaction('r', db.driverLocations, db.rideTracking, async () => {
        const stored = await db.rideTracking.get(String(ride._id))
        const queuedPoints = await db.driverLocations.where('rideId').equals(String(ride._id)).toArray()
        return { checkpoint: newestCheckpoint(stored, ride.trackingCheckpoint), queuedPoints }
    })
}
