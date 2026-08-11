import { db } from '@/shared/services/db'
import { flushQueuedLocations } from '@/shared/services/offlineQueue'

/**
 * Frequências de envio de GPS (documentadas — Phase 1 Capacitor).
 * - ONLINE sem serviço: 10s (economia de bateria + heartbeat lastSeenAt)
 * - Serviço ativo (corrida / encomenda / presencial): 5s (rastreamento)
 */
export const LOCATION_INTERVAL_ONLINE_MS = 10_000
export const LOCATION_INTERVAL_ACTIVE_MS = 5_000

const isDev = Boolean(import.meta.env.DEV)

function trackingPointId({ rideId, captainId, location, capturedAt }) {
    const lat = Number(location.lat).toFixed(6)
    const lng = Number(location.lng).toFixed(6)
    return `${rideId}:${captainId}:${capturedAt}:${lat}:${lng}`
}

/**
 * Envia (ou enfileira) a posição atual do motorista.
 * Identidade no backend vem do join autenticado — userId no payload é legado/opcional.
 */
export async function emitCaptainLocation({ socket, location, captainId, rideId = null }) {
    if (!location || location.lat == null || location.lng == null) return { sent: false }

    const payload = {
        userId: captainId,
        location: {
            ltd: location.lat,
            lng: location.lng,
            ...(Number.isFinite(location.accuracy) ? { accuracy: location.accuracy } : {}),
            ...(location.timestamp ? { timestamp: location.timestamp } : {}),
        },
    }

    // Durante uma corrida, persistimos ANTES de emitir mesmo quando online. Assim uma
    // queda entre o emit e o ack não cria um buraco irrecuperável na trajetória.
    if (rideId) {
        const capturedAt = Number(location.timestamp) || Date.now()
        const pointId = trackingPointId({ rideId, captainId, location, capturedAt })
        try {
            await db.driverLocations.put({
                pointId,
                rideId: String(rideId),
                userId: captainId,
                lat: location.lat,
                lng: location.lng,
                accuracy: location.accuracy ?? null,
                capturedAt,
                queuedAt: Date.now(),
            })
            if (socket?.connected) {
                await flushQueuedLocations(socket, { rideId })
                if (isDev) console.log('[Location] queued point confirmed')
                return { sent: true, confirmed: true }
            }
            if (isDev) console.log('[Location] update queued (offline)')
            return { sent: false, queued: true }
        } catch (e) {
            console.error('[Location] queue/sync failed', e)
            return { sent: false, queued: true }
        }
    }

    if (socket?.connected) {
        socket.emit('update-location-captain', payload)
        if (isDev) console.log('[Location] update sent')
        return { sent: true }
    }

    try {
        await db.driverLocations.add({
            userId: captainId,
            lat: location.lat,
            lng: location.lng,
            accuracy: location.accuracy ?? null,
            capturedAt: Number(location.timestamp) || Date.now(),
            queuedAt: Date.now(),
            pointId: `availability:${captainId}:${Number(location.timestamp) || Date.now()}`,
            rideId: null,
        })
        if (isDev) console.log('[Location] update queued (offline)')
        return { sent: false, queued: true }
    } catch (e) {
        console.error('[Location] queue failed', e)
        return { sent: false }
    }
}

export function resolveLocationIntervalMs({ isOnline, hasActiveTrip }) {
    if (hasActiveTrip) return LOCATION_INTERVAL_ACTIVE_MS
    if (isOnline) return LOCATION_INTERVAL_ONLINE_MS
    return null
}

export function resolveServiceKind({ captainRide, captainParcel }) {
    if (
        captainParcel
        && !['finished', 'cancelled', 'delivered'].includes(captainParcel.status)
    ) {
        return 'parcel'
    }
    if (
        captainRide
        && !['finished', 'cancelled'].includes(captainRide.status)
    ) {
        return captainRide.source === 'driver_initiated' ? 'presential' : 'ride'
    }
    return null
}

export function hasActiveService({ captainRide, captainParcel }) {
    return resolveServiceKind({ captainRide, captainParcel }) != null
}
