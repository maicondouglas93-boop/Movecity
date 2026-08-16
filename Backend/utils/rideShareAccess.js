const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { shareTokenSecret } = require('../services/auth.service');

const RIDE_SHARE_TTL_SECONDS = 60 * 60;
const ACTIVE_SHARED_RIDE_STATUSES = Object.freeze([
    'accepted',
    'going_to_pickup',
    'arrived',
    'waiting_passenger',
    'started',
]);
const TERMINAL_SHARED_RIDE_STATUSES = Object.freeze(['finished', 'cancelled']);

// JWT_SHARE_SECRET dedicado (política em auth.service.js) — nunca cai de volta no
// JWT_SECRET genérico compartilhado com passageiro/motorista/ADM.
function signingSecret(secret) {
    return secret || shareTokenSecret();
}

function hashShareId(shareId) {
    return crypto.createHash('sha256').update(String(shareId)).digest('hex');
}

function createRideShareAccess({ rideId, userId, secret } = {}) {
    if (!rideId || !userId) throw new Error('RIDE_AND_USER_REQUIRED');
    const shareId = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + RIDE_SHARE_TTL_SECONDS * 1000);
    const token = jwt.sign({
        scope: 'ride_share',
        rideId: String(rideId),
        userId: String(userId),
        shareId,
    }, signingSecret(secret), { expiresIn: RIDE_SHARE_TTL_SECONDS });

    return {
        token,
        record: {
            tokenHash: hashShareId(shareId),
            createdAt,
            expiresAt,
            revokedAt: null,
        },
    };
}

function verifyRideShareToken(token, { secret } = {}) {
    const payload = jwt.verify(token, signingSecret(secret));
    if (
        payload?.scope !== 'ride_share'
        || !payload.rideId
        || !payload.userId
        || !payload.shareId
    ) {
        throw new Error('INVALID_RIDE_SHARE');
    }
    return {
        rideId: String(payload.rideId),
        userId: String(payload.userId),
        shareId: String(payload.shareId),
    };
}

function safeHashEquals(actual, expected) {
    if (!actual || !expected) return false;
    const left = Buffer.from(String(actual));
    const right = Buffer.from(String(expected));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validateRideShareAccess(payload, shareAccess, now = new Date()) {
    const record = shareAccess?.toObject?.() || shareAccess;
    if (!record?.tokenHash || !payload?.shareId) return { valid: false, reason: 'missing' };
    if (record.revokedAt) return { valid: false, reason: 'revoked' };
    if (!record.expiresAt || new Date(record.expiresAt).getTime() <= now.getTime()) {
        return { valid: false, reason: 'expired' };
    }
    if (!safeHashEquals(record.tokenHash, hashShareId(payload.shareId))) {
        return { valid: false, reason: 'rotated' };
    }
    return { valid: true };
}

function publicCaptain(captain) {
    if (!captain) return null;
    return {
        fullname: captain.fullname,
        profilePicture: captain.profilePicture,
        rating: captain.rating,
        vehicle: captain.vehicle,
    };
}

function toSharedRideResponse({ ride, captain } = {}) {
    if (!ride) return null;
    const response = {
        rideId: ride._id,
        status: ride.status,
        pickup: ride.pickup,
        destination: ride.destination,
        updatedAt: ride.updatedAt,
        captain: publicCaptain(captain),
    };

    // A fonte é a posição vinculada ao compartilhamento/ corrida, nunca
    // captain.location. Assim, uma corrida antiga não revela onde o motorista está hoje.
    if (ACTIVE_SHARED_RIDE_STATUSES.includes(ride.status)) {
        const boundLocation = ride.shareLocation || ride.lastLocation;
        const lat = Number(boundLocation?.lat);
        const lng = Number(boundLocation?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            response.location = { lat, lng };
        }
    }

    return response;
}

module.exports = {
    RIDE_SHARE_TTL_SECONDS,
    ACTIVE_SHARED_RIDE_STATUSES,
    TERMINAL_SHARED_RIDE_STATUSES,
    createRideShareAccess,
    verifyRideShareToken,
    validateRideShareAccess,
    toSharedRideResponse,
};
