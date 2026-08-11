const MAX_LOCATION_AGE_MS = 2 * 60 * 1000;
const MAX_OFFLINE_LOCATION_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;
const MAX_ACCURACY_FOR_FARE_METERS = 100;
const MAX_SPEED_METERS_PER_SECOND = 60;
const MIN_MOVEMENT_TOLERANCE_METERS = 150;

function normalizeCaptainLocation(location, now = Date.now(), { maxAgeMs = MAX_LOCATION_AGE_MS } = {}) {
    const lat = Number(location?.ltd);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { valid: false, code: 'INVALID_COORDINATES' };
    }

    const rawTimestamp = location?.timestamp;
    const timestamp = rawTimestamp == null ? now : Number(rawTimestamp);
    if (!Number.isFinite(timestamp) || timestamp > now + MAX_FUTURE_SKEW_MS || timestamp < now - maxAgeMs) {
        return { valid: false, code: 'STALE_LOCATION' };
    }

    const accuracy = location?.accuracy == null ? null : Number(location.accuracy);
    if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) {
        return { valid: false, code: 'INVALID_ACCURACY' };
    }

    return {
        valid: true,
        location: { lat, lng, accuracy, timestamp },
        isAccurateForFare: accuracy === null || accuracy <= MAX_ACCURACY_FOR_FARE_METERS,
    };
}

function isPlausibleTravel(distanceMeters, elapsedMs) {
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0 || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
        return false;
    }
    const maximumDistance = Math.max(
        MIN_MOVEMENT_TOLERANCE_METERS,
        (elapsedMs / 1000) * MAX_SPEED_METERS_PER_SECOND
    );
    return distanceMeters <= maximumDistance;
}

module.exports = {
    MAX_LOCATION_AGE_MS,
    MAX_OFFLINE_LOCATION_AGE_MS,
    MAX_ACCURACY_FOR_FARE_METERS,
    normalizeCaptainLocation,
    isPlausibleTravel,
};
