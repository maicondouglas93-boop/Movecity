import { db } from '@/shared/services/db'
import { distanceMeters } from '@/shared/services/maps/navigationMath'

const MIN_SEGMENT_METERS = 5

export function sumTrailMeters(points) {
    const sorted = [...(points || [])]
        .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
        .sort((a, b) => (Number(a.capturedAt) || 0) - (Number(b.capturedAt) || 0))

    let total = 0
    for (let i = 1; i < sorted.length; i += 1) {
        const segment = distanceMeters(
            { lat: Number(sorted[i - 1].lat), lng: Number(sorted[i - 1].lng) },
            { lat: Number(sorted[i].lat), lng: Number(sorted[i].lng) },
        )
        if (Number.isFinite(segment) && segment >= MIN_SEGMENT_METERS) total += segment
    }
    return total
}

function optionalsTotal(ride) {
    if (!Array.isArray(ride?.optionals)) return 0
    return ride.optionals.reduce((sum, opt) => sum + (Number(opt?.price) || 0), 0)
}

function applyRounding(value, rule) {
    if (rule === 'up') return Math.ceil(value)
    if (rule === 'down') return Math.floor(value)
    if (rule === 'nearest') return Math.round(value)
    return Math.round(value * 100) / 100
}

/**
 * Valor que o passageiro deve pagar, calculado no celular com GPS enfileirado +
 * taxas congeladas da corrida (sem comissão). Usado para cobrar em dinheiro
 * quando o destino não tem internet.
 */
export function calculateOfflinePassengerFare({ ride, queuedPoints = [], now = Date.now() } = {}) {
    const rates = ride?.fareRates
    if (!rates) return null

    const queuedMeters = sumTrailMeters(queuedPoints)
    const syncedMeters = Math.max(0, Number(ride?.actualDistance) || 0)
    const actualDistance = syncedMeters + queuedMeters
    if (!(actualDistance > 0)) return null

    const startedMs = new Date(ride?.startedAt || ride?.createdAt || now).getTime()
    const elapsedSeconds = Math.max(0, Math.round((now - startedMs) / 1000))

    const minDistanceMeters = (Number(rates.minDistanceIncludedKm) || 0) * 1000
    const minTimeSeconds = (Number(rates.minTimeIncludedMin) || 0) * 60
    const chargeableDistance = Math.max(0, actualDistance - minDistanceMeters)
    const chargeableTime = Math.max(0, elapsedSeconds - minTimeSeconds)

    const baseFare = Number(rates.baseFare) || 0
    const distanceFare = (chargeableDistance / 1000) * (Number(rates.perKm) || 0)
    const timeFare = (chargeableTime / 60) * (Number(rates.perMinute) || 0)

    let waiting = 0
    const waitSeconds = Math.max(0, Number(ride?.waitTimeSeconds) || 0)
    if (rates.waitingActive !== false && waitSeconds > 0) {
        const freeSeconds = (Number(rates.waitingFreeMinutes) || 0) * 60
        waiting = (Math.max(0, waitSeconds - freeSeconds) / 60) * (Number(rates.waitingPerMinute) || 0)
    }

    let subtotal = baseFare + distanceFare + timeFare + waiting
        + optionalsTotal(ride)
        + (Number(rates.globalTariffsTotal) || 0)

    let minimumFareAdjustment = 0
    const minimumFare = Number(rates.minimumFare) || 0
    if (subtotal < minimumFare) {
        minimumFareAdjustment = minimumFare - subtotal
        subtotal = minimumFare
    }

    const amount = applyRounding(subtotal, rates.roundingRule)

    return {
        amount,
        actualDistance,
        elapsedSeconds,
        offline: true,
        fareBreakdown: {
            baseFare,
            distanceFare,
            timeFare,
            minimumFareAdjustment,
        },
    }
}

export async function buildOfflineFinishPreview(ride) {
    if (!ride?._id) return null
    const all = await db.driverLocations.orderBy('capturedAt').toArray()
    const queuedPoints = all.filter((point) => String(point.rideId || '') === String(ride._id))
    return calculateOfflinePassengerFare({ ride, queuedPoints })
}
