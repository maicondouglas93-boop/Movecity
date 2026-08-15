const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { haversineKm } = require('../services/maps/geo.util');
const { CAPTAIN_SEARCH_RADIUS_KM } = require('../config/dispatchPolicy');

// Mesma fronteira geográfica usada pelo despacho. O mapa pré-corrida nunca deve
// ampliar o alcance operacional definido para localizar motoristas.
const PUBLIC_DRIVER_MAP_RADIUS_KM = CAPTAIN_SEARCH_RADIUS_KM;
const PUBLIC_DRIVER_MAP_SUBSCRIPTION_TTL_SECONDS = 5 * 60;
const PUBLIC_LOCATION_DECIMALS = 3; // cerca de 110 m; posição exata só após vínculo.

function signingSecret(secret) {
    const value = secret || process.env.JWT_SECRET;
    if (!value) throw new Error('JWT_SECRET is required for public driver map');
    return value;
}

function normalizeCenter(center) {
    const lat = Number(center?.lat);
    const lng = Number(center?.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new Error('INVALID_MAP_CENTER');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new Error('INVALID_MAP_CENTER');
    }
    return { lat, lng };
}

function createPublicMapSubscription({ userId, center, secret } = {}) {
    if (!userId) throw new Error('USER_REQUIRED');
    const normalizedCenter = normalizeCenter(center);
    const nonce = crypto.randomBytes(16).toString('hex');
    const token = jwt.sign({
        purpose: 'public-driver-map',
        sub: String(userId),
        lat: normalizedCenter.lat,
        lng: normalizedCenter.lng,
        nonce,
    }, signingSecret(secret), {
        expiresIn: PUBLIC_DRIVER_MAP_SUBSCRIPTION_TTL_SECONDS,
    });
    const decoded = jwt.decode(token);

    return {
        token,
        nonce,
        expiresAt: decoded.exp * 1000,
        center: normalizedCenter,
    };
}

function verifyPublicMapSubscription(token, { secret } = {}) {
    const decoded = jwt.verify(token, signingSecret(secret));
    if (
        decoded?.purpose !== 'public-driver-map'
        || !decoded.sub
        || !decoded.nonce
        || !Number.isFinite(Number(decoded.exp))
    ) {
        throw new Error('INVALID_MAP_SUBSCRIPTION');
    }

    return {
        userId: String(decoded.sub),
        center: normalizeCenter({ lat: decoded.lat, lng: decoded.lng }),
        nonce: String(decoded.nonce),
        expiresAt: Number(decoded.exp) * 1000,
    };
}

function publicDriverId(driverId, nonce, { secret } = {}) {
    if (!driverId || !nonce) throw new Error('DRIVER_AND_NONCE_REQUIRED');
    const digest = crypto
        .createHmac('sha256', signingSecret(secret))
        .update(`${nonce}:${driverId}`)
        .digest('hex')
        .slice(0, 24);
    return `drv_${digest}`;
}

function toPublicLocation(location) {
    const lat = Number(location?.ltd ?? location?.lat);
    const lng = Number(location?.lng);
    if (
        !Number.isFinite(lat) || lat < -90 || lat > 90
        || !Number.isFinite(lng) || lng < -180 || lng > 180
    ) return null;
    const factor = 10 ** PUBLIC_LOCATION_DECIMALS;
    return {
        ltd: Math.round(lat * factor) / factor,
        lng: Math.round(lng * factor) / factor,
    };
}

function isWithinPublicMapRadius(center, location) {
    let normalizedCenter;
    try {
        normalizedCenter = normalizeCenter(center);
    } catch (_) {
        return false;
    }
    const lat = Number(location?.ltd ?? location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return haversineKm(normalizedCenter.lat, normalizedCenter.lng, lat, lng)
        <= PUBLIC_DRIVER_MAP_RADIUS_KM;
}

function toPublicDriver(captain, nonce, { secret } = {}) {
    if (!captain?._id) return null;
    const location = toPublicLocation(captain.location);
    if (!location) return null;
    return {
        id: publicDriverId(captain._id, nonce, { secret }),
        vehicleType: captain.vehicle?.vehicleType || 'car',
        vehicleAuthorization: captain.vehicleAuthorization,
        location,
    };
}

module.exports = {
    PUBLIC_DRIVER_MAP_RADIUS_KM,
    PUBLIC_DRIVER_MAP_SUBSCRIPTION_TTL_SECONDS,
    createPublicMapSubscription,
    verifyPublicMapSubscription,
    publicDriverId,
    toPublicLocation,
    isWithinPublicMapRadius,
    toPublicDriver,
};
