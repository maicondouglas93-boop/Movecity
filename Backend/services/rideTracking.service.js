const crypto = require('crypto');
const rideModel = require('../models/ride.model');
const mapService = require('./maps.service');
const {
    MAX_OFFLINE_LOCATION_AGE_MS,
    normalizeCaptainLocation,
    isPlausibleTravel,
} = require('../utils/captainLocationValidation');

const MIN_COUNTABLE_DISTANCE_METERS = 5;
const MAX_TRACKING_RETRIES = 5;

function buildPointId({ rideId, captainId, location, pointId }) {
    const supplied = typeof pointId === 'string' ? pointId.trim() : '';
    if (supplied && supplied.length <= 160) return supplied;

    const raw = [
        rideId,
        captainId,
        location?.timestamp ?? '',
        location?.ltd ?? '',
        location?.lng ?? '',
    ].join(':');
    return `legacy:${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

function lastLocationFilter(ride) {
    if (ride.lastLocation?.lat == null || ride.lastLocation?.lng == null) {
        return {
            $or: [
                { lastLocation: { $exists: false } },
                { 'lastLocation.lat': { $exists: false } },
                { 'lastLocation.lng': { $exists: false } },
            ],
        };
    }

    return {
        'lastLocation.lat': ride.lastLocation.lat,
        'lastLocation.lng': ride.lastLocation.lng,
        ...(ride.lastLocationAt ? { lastLocationAt: ride.lastLocationAt } : {}),
    };
}

async function confirmRejectedPoint({ ride, captainId, trackingPointId, reason }) {
    const updated = await rideModel.findOneAndUpdate(
        {
            _id: ride._id,
            captain: captainId,
            status: 'started',
            finalizationState: { $ne: 'finishing' },
            processedTrackingPointIds: { $ne: trackingPointId },
        },
        { $addToSet: { processedTrackingPointIds: trackingPointId } },
        { new: true, projection: { actualDistance: 1 } }
    );

    return {
        confirmed: true,
        accepted: false,
        reason: updated ? reason : 'RIDE_NO_LONGER_TRACKABLE',
        actualDistance: updated?.actualDistance ?? ride.actualDistance ?? 0,
        pointId: trackingPointId,
    };
}

/**
 * Confirma um ponto GPS de corrida com ordenação, idempotência e CAS.
 *
 * `lastLocationAt` representa o instante de captura no aparelho (não o instante do
 * replay), permitindo validar deslocamentos legítimos ocorridos durante uma queda de
 * internet. Pontos rejeitados são marcados como processados, mas nunca substituem o
 * último ponto válido usado pela tarifa.
 */
async function processRideTrackingPoint({ rideId, captainId, location, pointId, now = Date.now() }) {
    if (!rideId || !captainId) {
        return { confirmed: false, accepted: false, reason: 'RIDE_ID_REQUIRED' };
    }

    const normalized = normalizeCaptainLocation(location, now, {
        maxAgeMs: MAX_OFFLINE_LOCATION_AGE_MS,
    });
    const trackingPointId = buildPointId({ rideId, captainId, location, pointId });

    if (!normalized.valid) {
        return {
            confirmed: true,
            accepted: false,
            reason: normalized.code,
            pointId: trackingPointId,
        };
    }

    const point = normalized.location;

    for (let attempt = 0; attempt < MAX_TRACKING_RETRIES; attempt += 1) {
        const ride = await rideModel.findOne({ _id: rideId, captain: captainId })
            .select('+processedTrackingPointIds status actualDistance lastLocation lastLocationAt startedAt finalizationState');

        if (!ride) {
            return { confirmed: true, accepted: false, reason: 'RIDE_NOT_FOUND', pointId: trackingPointId };
        }

        if (ride.processedTrackingPointIds?.includes(trackingPointId)) {
            return {
                confirmed: true,
                accepted: true,
                duplicate: true,
                reason: 'ALREADY_PROCESSED',
                actualDistance: ride.actualDistance || 0,
                pointId: trackingPointId,
            };
        }

        if (ride.status !== 'started' || ride.finalizationState === 'finishing') {
            return {
                confirmed: true,
                accepted: false,
                reason: 'RIDE_NO_LONGER_TRACKABLE',
                actualDistance: ride.actualDistance || 0,
                pointId: trackingPointId,
            };
        }

        const startedAtMs = ride.startedAt ? new Date(ride.startedAt).getTime() : null;
        if (startedAtMs && point.timestamp < startedAtMs - 120000) {
            return confirmRejectedPoint({
                ride,
                captainId,
                trackingPointId,
                reason: 'POINT_BEFORE_RIDE_START',
            });
        }

        const previous = ride.lastLocation;
        if (!previous || previous.lat == null || previous.lng == null) {
            const initialized = await rideModel.findOneAndUpdate(
                {
                    _id: ride._id,
                    captain: captainId,
                    status: 'started',
                    finalizationState: { $ne: 'finishing' },
                    processedTrackingPointIds: { $ne: trackingPointId },
                    ...lastLocationFilter(ride),
                },
                {
                    $set: {
                        lastLocation: { lat: point.lat, lng: point.lng },
                        lastLocationAt: new Date(point.timestamp),
                    },
                    $addToSet: { processedTrackingPointIds: trackingPointId },
                },
                { new: true, projection: { actualDistance: 1 } }
            );
            if (initialized) {
                return {
                    confirmed: true,
                    accepted: true,
                    countedDistanceMeters: 0,
                    actualDistance: initialized.actualDistance || 0,
                    pointId: trackingPointId,
                };
            }
            continue;
        }

        // Corridas iniciadas antes da migração podem ter lastLocation sem
        // lastLocationAt. Usa startedAt como limite conservador em vez de aceitar um
        // salto arbitrário sem qualquer validação temporal.
        const previousAtMs = ride.lastLocationAt
            ? new Date(ride.lastLocationAt).getTime()
            : (ride.startedAt ? new Date(ride.startedAt).getTime() : null);
        if (previousAtMs && point.timestamp <= previousAtMs) {
            return confirmRejectedPoint({
                ride,
                captainId,
                trackingPointId,
                reason: 'OUT_OF_ORDER_POINT',
            });
        }

        const distMeters = mapService.haversineKm(
            previous.lat,
            previous.lng,
            point.lat,
            point.lng
        ) * 1000;
        const elapsedMs = previousAtMs ? point.timestamp - previousAtMs : null;
        const plausibleTravel = elapsedMs == null || isPlausibleTravel(distMeters, elapsedMs);
        const accurate = normalized.isAccurateForFare;

        if (!accurate || !plausibleTravel) {
            return confirmRejectedPoint({
                ride,
                captainId,
                trackingPointId,
                reason: !accurate ? 'INACCURATE_POINT' : 'IMPLAUSIBLE_TRAVEL',
            });
        }

        const countDistance = distMeters > MIN_COUNTABLE_DISTANCE_METERS;
        const update = {
            $set: {
                lastLocation: { lat: point.lat, lng: point.lng },
                lastLocationAt: new Date(point.timestamp),
            },
            $addToSet: { processedTrackingPointIds: trackingPointId },
        };
        if (countDistance) update.$inc = { actualDistance: distMeters };

        const applied = await rideModel.findOneAndUpdate(
            {
                _id: ride._id,
                captain: captainId,
                status: 'started',
                finalizationState: { $ne: 'finishing' },
                processedTrackingPointIds: { $ne: trackingPointId },
                ...lastLocationFilter(ride),
            },
            update,
            { new: true, projection: { actualDistance: 1 } }
        );

        if (applied) {
            return {
                confirmed: true,
                accepted: true,
                countedDistanceMeters: countDistance ? distMeters : 0,
                actualDistance: applied.actualDistance || 0,
                pointId: trackingPointId,
            };
        }
    }

    return { confirmed: false, accepted: false, reason: 'TRACKING_CONFLICT', pointId: trackingPointId };
}

module.exports = {
    MIN_COUNTABLE_DISTANCE_METERS,
    processRideTrackingPoint,
};
