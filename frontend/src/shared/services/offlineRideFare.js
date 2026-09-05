import { readTrackingState } from '@/shared/services/rideTrackingCheckpoint'
import { distanceMeters } from '@/shared/services/maps/navigationMath'

const MIN_SEGMENT_METERS = 5

export function sumTrailMeters(points, { anchor = null, anchorAt = null, startedAt = null, now = Date.now() } = {}) {
    const sorted = [...(points || [])]
        .sort((a, b) => (Number(a.capturedAt) || 0) - (Number(b.capturedAt) || 0))

    let total = 0
    let previous = anchor
    let previousAt = anchorAt ? new Date(anchorAt).getTime() : (startedAt ? new Date(startedAt).getTime() : null)
    const start = startedAt ? new Date(startedAt).getTime() : null
    const seen = new Set()
    for (const point of sorted) {
        const lat = Number(point.lat), lng = Number(point.lng), at = Number(point.capturedAt)
        const accuracy = point.accuracy == null ? null : Number(point.accuracy)
        // Mesmos limites de captainLocationValidation / rideTracking.service.
        // Não inventar km a partir de GPS ruim nem contar pontos após o encerramento.
        if (point.lat == null || point.lng == null || !Number.isFinite(lat) || Math.abs(lat) > 90
            || !Number.isFinite(lng) || Math.abs(lng) > 180 || !Number.isFinite(at)
            || at > now || at < now - 86400000 || (start && at < start - 120000)
            || (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100))) continue
        if (point.pointId && seen.has(point.pointId)) continue
        if (point.pointId) seen.add(point.pointId)
        if (previous && previousAt != null && at <= previousAt) continue
        if (previous) {
            const segment = distanceMeters(previous, { lat, lng })
            const maxDistance = previousAt == null ? Infinity : Math.max(150, ((at - previousAt) / 1000) * 60)
            if (!Number.isFinite(segment) || segment > maxDistance) continue
            if (segment > MIN_SEGMENT_METERS) total += segment
        }
        previous = { lat, lng }
        previousAt = at
    }
    return total
}

function optionalsTotal(ride) {
    if (!Array.isArray(ride?.optionals)) return 0
    return ride.optionals.reduce((sum, opt) => sum + (Number(opt?.price) || 0), 0)
}

function parseClockToHours(text, fallback) {
    const [h, m] = String(text || fallback).split(':').map(Number)
    if (!Number.isFinite(h)) return null
    return h + ((Number.isFinite(m) ? m : 0) / 60)
}

/** Mesma regra de janela do servidor, inclusive quando o período cruza a meia-noite. */
export function isNightTime(rates, at) {
    const start = parseClockToHours(rates?.nightStartTime, '22:00')
    const end = parseClockToHours(rates?.nightEndTime, '06:00')
    if (start == null || end == null) return false

    const current = at.getHours() + (at.getMinutes() / 60)
    return start > end
        ? (current >= start || current <= end)
        : (current >= start && current <= end)
}

function nightSurcharge(rates, subtotal, at) {
    if (rates?.nightActive !== true) return 0
    if (!isNightTime(rates, at)) return 0

    const value = Number(rates.nightValue) || 0
    if (rates.nightType === 'fixed') return value
    // 'multiplier': 1.2 significa +20% sobre o subtotal, não 1,2%.
    return subtotal * Math.max(0, value - 1)
}

function rainSurcharge(rates, subtotal) {
    if (rates?.rainActive !== true) return 0

    const value = Number(rates.rainValue) || 0
    if (rates.rainType === 'fixed') return value
    return subtotal * (value / 100)
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

    const checkpoint = ride?.trackingCheckpoint
    const queuedMeters = sumTrailMeters(queuedPoints, {
        anchor: checkpoint?.lastLocation, anchorAt: checkpoint?.lastLocationAt,
        startedAt: ride?.startedAt, now,
    })
    const syncedMeters = Math.max(0, Number(checkpoint?.actualDistance ?? ride?.actualDistance) || 0)
    const actualDistance = syncedMeters + queuedMeters
    const startedMs = new Date(ride?.startedAt || ride?.createdAt || now).getTime()
    if (!Number.isFinite(startedMs)) return null
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

    let subtotal = baseFare + distanceFare + timeFare + waiting + optionalsTotal(ride)

    // Adicionais noturno e de chuva incidem sobre o subtotal ANTES das tarifas globais,
    // na mesma ordem do motor de preço do servidor (pricingEngine.service.js). Sem eles
    // o app mandava cobrar menos do que a finalização registraria, e o motorista pagava
    // comissão sobre a diferença que nunca recebeu.
    const night = nightSurcharge(rates, subtotal, new Date(now))
    const rain = rainSurcharge(rates, subtotal)
    subtotal += night + rain

    subtotal += (Number(rates.globalTariffsTotal) || 0)

    let minimumFareAdjustment = 0
    const minimumFare = Number(rates.minimumFare) || 0
    if (subtotal < minimumFare) {
        minimumFareAdjustment = minimumFare - subtotal
        subtotal = minimumFare
    }

    // Cupom entra depois do piso, igual ao servidor — desconto não é acréscimo.
    const discount = Math.min(Math.max(0, Number(ride?.discountAmount) || 0), subtotal)
    subtotal -= discount

    const amount = applyRounding(subtotal, rates.roundingRule)

    return {
        amount,
        actualDistance,
        syncedDistance: syncedMeters,
        elapsedSeconds,
        offline: true,
        fareBreakdown: {
            baseFare,
            distanceFare,
            timeFare,
            nightSurcharge: night,
            rainSurcharge: rain,
            discount,
            minimumFareAdjustment,
        },
    }
}

export async function buildOfflineFinishPreview(ride, now = Date.now()) {
    if (!ride?._id) return null
    const { checkpoint, queuedPoints } = await readTrackingState(ride)
    const fare = calculateOfflinePassengerFare({ ride: { ...ride, trackingCheckpoint: checkpoint }, queuedPoints, now })
    return fare ? { ...fare, pendingPoints: queuedPoints.length, trackingCheckpoint: checkpoint } : null
}
