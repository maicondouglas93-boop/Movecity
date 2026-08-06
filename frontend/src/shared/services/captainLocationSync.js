import { db } from '@/shared/services/db'

/**
 * Frequências de envio de GPS (documentadas — Phase 1 Capacitor).
 * - ONLINE sem serviço: 10s (economia de bateria + heartbeat lastSeenAt)
 * - Serviço ativo (corrida / encomenda / presencial): 5s (rastreamento)
 */
export const LOCATION_INTERVAL_ONLINE_MS = 10_000
export const LOCATION_INTERVAL_ACTIVE_MS = 5_000

/** Máximo de pontos na fila offline — flush envia só o último; evita fila infinita. */
const MAX_QUEUED_LOCATIONS = 20

const isDev = Boolean(import.meta.env.DEV)

/**
 * Envia (ou enfileira) a posição atual do motorista.
 * Identidade no backend vem do join autenticado — userId no payload é legado/opcional.
 */
export async function emitCaptainLocation({ socket, location, captainId }) {
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
            timestamp: Date.now(),
        })
        const count = await db.driverLocations.count()
        if (count > MAX_QUEUED_LOCATIONS) {
            const overflow = await db.driverLocations
                .orderBy('id')
                .limit(count - MAX_QUEUED_LOCATIONS)
                .primaryKeys()
            if (overflow.length) await db.driverLocations.bulkDelete(overflow)
        }
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
