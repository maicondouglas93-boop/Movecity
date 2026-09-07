import { readTrackingState } from '@/shared/services/rideTrackingCheckpoint'
import { measureTrail } from '@/shared/services/offlineRideFare'
import { distanceMeters } from '@/shared/services/maps/navigationMath'

const validLocation = (point) => point?.lat != null && point?.lng != null
    && Number.isFinite(Number(point.lat)) && Math.abs(Number(point.lat)) <= 90
    && Number.isFinite(Number(point.lng)) && Math.abs(Number(point.lng)) <= 180

export function needsFinishLocation(ride) {
    return Boolean(ride?.destinationPending || (ride?.source === 'driver_initiated' && !ride?.destination))
}

// Espelha as travas de endRide no servidor. É uma pré-validação, nunca uma
// confirmação de cobrança: sincronização, autorização e preço continuam no backend.
export function offlineFinishIssue({ ride, checkpoint, queuedPoints = [], payload }) {
    if (!needsFinishLocation(ride)) return null
    const now = payload.finishTimestamp
    const anchor = checkpoint?.lastLocation || ride.lastLocation
    const anchorAt = checkpoint?.lastLocationAt || ride.lastLocationAt
    const points = [...queuedPoints]
    if (payload.finishLat != null && payload.finishLng != null) {
        points.push({ lat: payload.finishLat, lng: payload.finishLng,
            accuracy: payload.finishAccuracy, capturedAt: payload.finishLocationTimestamp })
    }
    const trail = measureTrail(points, {
        anchor: validLocation(anchor) ? { lat: Number(anchor.lat), lng: Number(anchor.lng) } : null,
        anchorAt, startedAt: ride.startedAt, now,
    })
    if (!validLocation(trail.lastLocation)) {
        return { code: 'INVALID_FINISH_LOCATION', message: 'GPS indisponível para finalizar. Mantenha a localização ativa e tente novamente. A corrida não foi encerrada.' }
    }
    if (!trail.lastLocationAt || now - trail.lastLocationAt > 120000) {
        return { code: 'STALE_FINISH_LOCATION', message: 'Localização desatualizada para finalizar. Aguarde uma posição GPS atual e tente novamente. A corrida não foi encerrada.' }
    }
    const meters = Math.max(0, Number(checkpoint?.actualDistance ?? ride.actualDistance) || 0) + trail.meters
    const origin = {
        lat: ride.pickupCoordinates?.lat ?? ride.origin?.coordinates?.[1],
        lng: ride.pickupCoordinates?.lng ?? ride.origin?.coordinates?.[0],
    }
    const displacement = validLocation(origin)
        ? distanceMeters({ lat: Number(origin.lat), lng: Number(origin.lng) }, trail.lastLocation) : null
    if (!(meters > 0) || (meters <= 50 && displacement != null && displacement < 50)) {
        return { code: 'INSUFFICIENT_TRIP_DISTANCE', message: 'Distância insuficiente para finalizar. Tempo parado não substitui o deslocamento. A corrida não foi encerrada e nenhum valor foi confirmado.' }
    }
    return null
}

export async function getOfflineFinishIssue(ride, payload) {
    if (!needsFinishLocation(ride)) return null
    const { checkpoint, queuedPoints } = await readTrackingState(ride)
    return offlineFinishIssue({ ride, payload, checkpoint, queuedPoints })
}
