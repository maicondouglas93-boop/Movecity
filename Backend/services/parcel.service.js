const crypto = require('crypto');
const parcelModel = require('../models/parcel.model');
const parcelSettingModel = require('../models/parcelSetting.model');
const mapService = require('./maps.service');
const dispatchService = require('./dispatch.service');
const userModel = require('../models/user.model');

const SIZE_RANK = { small: 1, medium: 2, large: 3 };

const VALID_ORIGINS_BY_TARGET = {
    going_to_pickup: ['provider_accepted'],
    arrived_pickup: ['going_to_pickup'],
    collected: ['arrived_pickup'],
    in_transit: ['collected'],
    arrived_destination: ['in_transit'],
};

const PARCEL_EXPIRATION_MINUTES = 10;

function parcelExpirationCutoff() {
    return new Date(Date.now() - PARCEL_EXPIRATION_MINUTES * 60 * 1000);
}

/** Cancela awaiting_provider expirados (lazy, espelha ride getCurrent). */
async function expireStaleAwaitingParcels({ userId } = {}) {
    const filter = {
        status: 'awaiting_provider',
        createdAt: { $lt: parcelExpirationCutoff() },
    };
    if (userId) filter.user = userId;

    const stale = await parcelModel.find(filter).select('_id').limit(20);
    const cancelled = [];
    for (const doc of stale) {
        const updated = await module.exports.cancelParcelSystem(doc._id, 'expired');
        if (updated) cancelled.push(updated);
    }
    return cancelled;
}

async function getSettings() {
    let settings = await parcelSettingModel.findOne().sort({ updatedAt: -1 });
    if (!settings) {
        settings = await parcelSettingModel.create({});
    }
    return settings;
}

function generateDeliveryPin() {
    return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

function pushHistory(parcel, status, by = 'system') {
    parcel.statusHistory = parcel.statusHistory || [];
    parcel.statusHistory.push({ status, at: new Date(), by });
}

module.exports.validateVehicleCompatibility = async ({ vehicleType, size, weightKg }) => {
    const settings = await getSettings();
    const warnings = [];
    if (vehicleType === 'moto') {
        const maxRank = SIZE_RANK[settings.motoMaxSize] || 2;
        const sizeRank = SIZE_RANK[size] || 1;
        if (sizeRank > maxRank) {
            warnings.push('Item grande demais para moto — recomendamos carro.');
        }
        if (Number(weightKg) > settings.motoMaxWeightKg) {
            warnings.push(`Peso acima de ${settings.motoMaxWeightKg} kg — recomendamos carro.`);
        }
    }
    const blocked = settings.blockIncompatibleMoto && warnings.length > 0 && vehicleType === 'moto';
    return { warnings, blocked, settings };
};

module.exports.getParcelFare = async ({ pickup, destination, vehicleType }) => {
    if (!pickup || !destination || !vehicleType) {
        throw new Error('pickup, destination e vehicleType são obrigatórios');
    }
    if (!['moto', 'car'].includes(vehicleType)) {
        throw new Error('vehicleType inválido');
    }

    const settings = await getSettings();
    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    const distanceM = distanceTime.distance.value;
    const durationS = distanceTime.duration.value;
    const km = distanceM / 1000;
    const minutes = durationS / 60;

    const surcharge = settings.vehicleSurcharge?.[vehicleType] || 0;
    let fare = settings.baseFare + (km * settings.perKm) + (minutes * settings.perMinute) + surcharge;
    fare = Math.max(fare, settings.minimumFare);
    fare = Math.round(fare * 100) / 100;

    const pricingSnapshot = {
        baseFare: settings.baseFare,
        perKm: settings.perKm,
        perMinute: settings.perMinute,
        minimumFare: settings.minimumFare,
        vehicleSurcharge: surcharge,
        vehicleType,
    };

    return {
        fare,
        estimatedDistance: distanceM,
        estimatedTime: durationS,
        fareBreakdown: {
            baseFare: settings.baseFare,
            distanceComponent: Math.round(km * settings.perKm * 100) / 100,
            timeComponent: Math.round(minutes * settings.perMinute * 100) / 100,
            vehicleSurcharge: surcharge,
            minimumApplied: fare === settings.minimumFare,
        },
        pricingSnapshot,
    };
};

const USER_ACTIVE_PARCEL_STATUSES = [
    'awaiting_provider',
    'provider_accepted',
    'going_to_pickup',
    'arrived_pickup',
    'collected',
    'in_transit',
    'arrived_destination',
    'delivered',
];

module.exports.createParcel = async (payload) => {
    const {
        user,
        pickup,
        destination,
        vehicleType,
        sender,
        recipient,
        itemName,
        category,
        weightKg,
        size,
        description = '',
        notes = '',
        paymentMethod = 'cash',
    } = payload;

    if (!user || !pickup || !destination || !vehicleType || !sender || !recipient) {
        throw new Error('Campos obrigatórios ausentes');
    }

    const allowedPay = ['cash', 'card', 'pix', 'carteira'];
    const safePayment = allowedPay.includes(paymentMethod) ? paymentMethod : 'cash';

    const existingParcel = await parcelModel.findOne({
        user,
        status: { $in: USER_ACTIVE_PARCEL_STATUSES },
    }).select('_id status');
    if (existingParcel) {
        const err = new Error('USER_HAS_ACTIVE_PARCEL');
        err.code = 'USER_HAS_ACTIVE_PARCEL';
        throw err;
    }

    const rideModel = require('../models/ride.model');
    const existingRide = await rideModel.findOne({
        user,
        status: { $in: dispatchService.ACTIVE_RIDE_STATUSES },
    }).select('_id');
    if (existingRide) {
        const err = new Error('USER_HAS_ACTIVE_RIDE');
        err.code = 'USER_HAS_ACTIVE_RIDE';
        throw err;
    }

    const compatibility = await module.exports.validateVehicleCompatibility({
        vehicleType,
        size,
        weightKg,
    });
    if (compatibility.blocked) {
        const err = new Error(compatibility.warnings[0] || 'Veículo incompatível com o item');
        err.code = 'VEHICLE_INCOMPATIBLE';
        throw err;
    }

    const fareData = await module.exports.getParcelFare({ pickup, destination, vehicleType });
    let destinationCoordinates;
    try {
        const dest = await mapService.getAddressCoordinate(destination);
        destinationCoordinates = { lat: dest.ltd, lng: dest.lng };
    } catch {
        destinationCoordinates = undefined;
    }

    const deliveryPin = generateDeliveryPin();
    let parcel;
    try {
        parcel = await parcelModel.create({
            user,
            vehicleType,
            pickup,
            destination,
            destinationCoordinates,
            sender,
            recipient,
            itemName,
            category,
            weightKg,
            size,
            description,
            notes,
            schedule: { mode: 'now', at: null },
            fare: fareData.fare,
            estimatedDistance: fareData.estimatedDistance,
            estimatedTime: fareData.estimatedTime,
            fareBreakdown: fareData.fareBreakdown,
            pricingSnapshot: fareData.pricingSnapshot,
            deliveryPin,
            status: 'awaiting_provider',
            statusHistory: [{ status: 'awaiting_provider', at: new Date(), by: 'user' }],
            photos: { pickupUrl: null, deliveryUrl: null },
            paymentMethod: safePayment,
        });
    } catch (err) {
        if (err.code === 11000) {
            const dup = new Error('USER_HAS_ACTIVE_PARCEL');
            dup.code = 'USER_HAS_ACTIVE_PARCEL';
            throw dup;
        }
        throw err;
    }

    return {
        parcel,
        warnings: compatibility.warnings,
    };
};

module.exports.acceptParcelAtomic = async ({ parcelId, captain }) => {
    if (!parcelId || !captain) throw new Error('PARCEL_ID_AND_CAPTAIN_REQUIRED');

    const captainModel = require('../models/captain.model');
    const mapService = require('./maps.service');
    const freshCaptain = await captainModel.findById(captain._id)
        .select('approvalStatus isBlocked canReceiveRides isOnline location vehicle busyLock');
    if (!freshCaptain) throw new Error('CAPTAIN_NOT_ALLOWED');

    if (
        freshCaptain.approvalStatus !== 'aprovado'
        || freshCaptain.isBlocked
        || freshCaptain.canReceiveRides === false
        || freshCaptain.isOnline !== true
    ) {
        throw new Error('CAPTAIN_NOT_ALLOWED');
    }

    // Recovery: busyLock órfão sem trabalho ativo.
    if (freshCaptain.busyLock === true) {
        const hasWork = (await dispatchService.captainHasActiveRide(freshCaptain._id))
            || (await dispatchService.captainHasActiveParcel(freshCaptain._id));
        if (!hasWork) {
            await dispatchService.releaseCaptainBusyLock(freshCaptain._id);
        }
    }

    const locked = await dispatchService.acquireCaptainBusyLock(freshCaptain._id);
    if (!locked) {
        throw new Error('CAPTAIN_HAS_ACTIVE_RIDE');
    }

    try {
        if (await dispatchService.captainHasActiveRide(freshCaptain._id)) {
            throw new Error('CAPTAIN_HAS_ACTIVE_RIDE');
        }
        if (await dispatchService.captainHasActiveParcel(freshCaptain._id)) {
            throw new Error('CAPTAIN_HAS_ACTIVE_PARCEL');
        }

        const vehicleType = freshCaptain.vehicle?.vehicleType;
        const existing = await parcelModel.findById(parcelId);
        if (!existing) throw new Error('PARCEL_NOT_FOUND');
        if (existing.status === 'cancelled') throw new Error('PARCEL_CANCELLED');
        if (existing.status !== 'awaiting_provider') throw new Error('PARCEL_ALREADY_ACCEPTED');
        if (existing.vehicleType !== vehicleType) throw new Error('VEHICLE_MISMATCH');

        // Revalida raio no accept (pending já filtra, mas a API não pode confiar nisso).
        let pickup = existing.pickupCoordinates;
        if (!pickup || pickup.lat == null || pickup.lng == null) {
            try {
                const geo = await mapService.getAddressCoordinate(existing.pickup);
                pickup = { lat: geo.ltd, lng: geo.lng };
                existing.pickupCoordinates = pickup;
                await existing.save();
            } catch {
                throw new Error('OUT_OF_RANGE');
            }
        }
        const pos = freshCaptain.location;
        if (!pos || pos.ltd == null || pos.lng == null) {
            throw new Error('OUT_OF_RANGE');
        }
        const km = mapService.haversineKm(pos.ltd, pos.lng, pickup.lat, pickup.lng);
        if (km > dispatchService.CAPTAIN_SEARCH_RADIUS_KM) {
            throw new Error('OUT_OF_RANGE');
        }

        const updated = await parcelModel.findOneAndUpdate(
            { _id: parcelId, status: 'awaiting_provider' },
            {
                $set: {
                    captain: freshCaptain._id,
                    status: 'provider_accepted',
                },
                $push: {
                    statusHistory: {
                        status: 'provider_accepted',
                        at: new Date(),
                        by: 'captain',
                    },
                },
            },
            { new: true }
        ).populate('user').populate('captain');

        if (!updated) throw new Error('PARCEL_ALREADY_ACCEPTED');
        return updated;
    } catch (err) {
        await dispatchService.releaseCaptainBusyLock(freshCaptain._id);
        if (err.code === 11000) throw new Error('CAPTAIN_HAS_ACTIVE_PARCEL');
        throw err;
    }
};

module.exports.updateParcelStatus = async ({ parcelId, captain, status }) => {
    const allowedOrigins = VALID_ORIGINS_BY_TARGET[status];
    if (!allowedOrigins) {
        throw new Error('INVALID_STATUS_TRANSITION');
    }

    const parcel = await parcelModel.findOne({ _id: parcelId, captain: captain._id });
    if (!parcel) throw new Error('PARCEL_NOT_FOUND');
    if (!allowedOrigins.includes(parcel.status)) {
        throw new Error('INVALID_STATUS_TRANSITION');
    }

    parcel.status = status;
    pushHistory(parcel, status, 'captain');
    await parcel.save();
    return parcelModel.findById(parcelId).populate('user').populate('captain');
};

module.exports.confirmDelivery = async ({ parcelId, captain, pin }) => {
    const settings = await getSettings();
    const parcel = await parcelModel.findOne({ _id: parcelId, captain: captain._id }).select('+deliveryPin');
    if (!parcel) throw new Error('PARCEL_NOT_FOUND');
    if (parcel.status !== 'arrived_destination') {
        throw new Error('INVALID_STATUS_FOR_DELIVERY');
    }

    if (settings.requireDeliveryPin) {
        if (!pin || String(pin) !== String(parcel.deliveryPin)) {
            throw new Error('INVALID_PIN');
        }
    }

    const now = new Date();
    const updated = await parcelModel.findOneAndUpdate(
        { _id: parcelId, captain: captain._id, status: 'arrived_destination' },
        {
            $set: { status: 'finished' },
            $push: {
                statusHistory: {
                    $each: [
                        { status: 'delivered', at: now, by: 'captain' },
                        { status: 'finished', at: now, by: 'system' },
                    ],
                },
            },
        },
        { new: true }
    ).populate('user').populate('captain');

    if (!updated) throw new Error('INVALID_STATUS_FOR_DELIVERY');

    await dispatchService.releaseCaptainBusyLock(captain._id);
    return updated;
};

/** Recupera docs legados presos em `delivered` (pré-fix atômico). */
module.exports.finalizeStuckDelivered = async (parcelId) => {
    const now = new Date();
    const updated = await parcelModel.findOneAndUpdate(
        { _id: parcelId, status: 'delivered' },
        {
            $set: { status: 'finished' },
            $push: {
                statusHistory: { status: 'finished', at: now, by: 'system' },
            },
        },
        { new: true }
    ).populate('user').populate('captain');
    if (updated?.captain) {
        await dispatchService.releaseCaptainBusyLock(updated.captain._id || updated.captain);
    }
    return updated;
};

module.exports.cancelParcel = async ({ parcelId, user, reason, by = 'passenger' }) => {
    const parcel = await parcelModel.findOne({ _id: parcelId, user });
    if (!parcel) throw new Error('PARCEL_NOT_FOUND');

    // MVP: cancel só até chegada na retirada (antes da coleta).
    const cancellable = [
        'awaiting_provider',
        'provider_accepted',
        'going_to_pickup',
        'arrived_pickup',
    ];
    if (!cancellable.includes(parcel.status)) {
        throw new Error('PARCEL_NOT_CANCELLABLE');
    }

    const captainId = parcel.captain;
    parcel.status = 'cancelled';
    parcel.cancelledBy = by;
    parcel.cancellationReason = reason || '';
    parcel.cancelledAt = new Date();
    pushHistory(parcel, 'cancelled', by === 'passenger' ? 'user' : by);
    await parcel.save();
    if (captainId) {
        await dispatchService.releaseCaptainBusyLock(captainId);
    }
    return parcelModel.findById(parcelId).populate('user').populate('captain');
};

/** Cancelamento interno (ex.: falha de despacho após create). */
module.exports.cancelParcelSystem = async (parcelId, reason = 'dispatch_failed') => {
    const parcel = await parcelModel.findById(parcelId);
    if (!parcel) return null;
    if (['finished', 'cancelled'].includes(parcel.status)) return parcel;

    const captainId = parcel.captain;
    parcel.status = 'cancelled';
    parcel.cancelledBy = 'system';
    parcel.cancellationReason = reason;
    parcel.cancelledAt = new Date();
    pushHistory(parcel, 'cancelled', 'system');
    await parcel.save();
    if (captainId) {
        await dispatchService.releaseCaptainBusyLock(captainId);
    }
    return parcelModel.findById(parcelId).populate('user').populate('captain');
};

module.exports.declineParcel = async ({ parcelId, captain }) => {
    // ACK/log apenas — não altera status nem captain.
    console.log(`[PARCEL] Captain ${captain?._id} declined offer ${parcelId} (ACK only)`);
    return { ok: true };
};

module.exports.getCurrentParcelForUser = async (userId) => {
    // Safety net: docs legados em `delivered` viram finished.
    const stuck = await parcelModel.findOne({ user: userId, status: 'delivered' }).select('_id');
    if (stuck) {
        await module.exports.finalizeStuckDelivered(stuck._id);
    }

    await expireStaleAwaitingParcels({ userId });

    const active = [
        'awaiting_provider',
        'provider_accepted',
        'going_to_pickup',
        'arrived_pickup',
        'collected',
        'in_transit',
        'arrived_destination',
    ];
    const current = await parcelModel.findOne({
        user: userId,
        status: { $in: active },
    }).populate('captain').select('+deliveryPin').sort({ createdAt: -1 });
    if (current) return current;

    // Após finalização, mantém na tela de avaliação até o passageiro avaliar ou pular
    const finished = await parcelModel.findOne({
        user: userId,
        status: 'finished',
        $or: [
            { passengerReviewSkippedAt: null },
            { passengerReviewSkippedAt: { $exists: false } },
        ],
    }).populate('captain').select('+deliveryPin').sort({ createdAt: -1 });
    if (!finished) return null;

    const reviewModel = require('../models/review.model');
    const reviewed = await reviewModel.findOne({
        subjectType: 'parcel',
        subjectId: finished._id,
        user: userId,
        type: 'passenger_to_driver',
    });
    return reviewed ? null : finished;
};

module.exports.getCurrentParcelForCaptain = async (captainId) => {
    const active = await parcelModel.findOne({
        captain: captainId,
        status: { $in: dispatchService.ACTIVE_PARCEL_STATUSES },
    }).populate('user').sort({ createdAt: -1 });
    if (active) return active;

    // Rating pós-entrega: finished sem avaliação do motorista (sobrevive refresh).
    const finished = await parcelModel.findOne({
        captain: captainId,
        status: 'finished',
        $or: [
            { captainReviewSkippedAt: null },
            { captainReviewSkippedAt: { $exists: false } },
        ],
    }).populate('user').sort({ createdAt: -1 });
    if (!finished) return null;

    const reviewModel = require('../models/review.model');
    const reviewed = await reviewModel.findOne({
        subjectType: 'parcel',
        subjectId: finished._id,
        captain: captainId,
        type: 'driver_to_passenger',
    });
    return reviewed ? null : finished;
};

module.exports.getPendingParcelsForCaptain = async ({ captain }) => {
    if (!captain) throw new Error('Captain is required');

    if (await dispatchService.captainHasActiveRide(captain._id)) return [];
    if (await dispatchService.captainHasActiveParcel(captain._id)) return [];

    const captainModel = require('../models/captain.model');
    const freshCaptain = await captainModel.findById(captain._id)
        .select('location vehicle isOnline isBlocked canReceiveRides approvalStatus');
    if (!freshCaptain) return [];

    const isAvailable = freshCaptain.isOnline === true
        && freshCaptain.isBlocked !== true
        && freshCaptain.canReceiveRides !== false
        && freshCaptain.approvalStatus === 'aprovado';
    if (!isAvailable) return [];

    const vehicleType = freshCaptain.vehicle?.vehicleType;
    if (!vehicleType || !['moto', 'car'].includes(vehicleType)) return [];

    const position = freshCaptain.location;
    if (!position || position.ltd == null || position.lng == null) return [];

    await expireStaleAwaitingParcels();

    const candidates = await parcelModel.find({
        status: 'awaiting_provider',
        vehicleType,
        createdAt: { $gte: parcelExpirationCutoff() },
        'pickupCoordinates.lat': { $exists: true },
    }).sort({ createdAt: -1 }).limit(20);

    return candidates.filter((parcel) => {
        const pickup = parcel.pickupCoordinates;
        if (!pickup || pickup.lat == null || pickup.lng == null) return false;
        return mapService.haversineKm(
            position.ltd,
            position.lng,
            pickup.lat,
            pickup.lng
        ) <= dispatchService.CAPTAIN_SEARCH_RADIUS_KM;
    }).map((parcel) => module.exports.toParcelOfferDTO(parcel));
};

module.exports.getSettings = getSettings;

module.exports.toParcelOfferDTO = (parcel) => {
    const raw = typeof parcel.toObject === 'function' ? parcel.toObject() : { ...parcel };
    return {
        _id: raw._id,
        vehicleType: raw.vehicleType,
        pickup: raw.pickup,
        destination: raw.destination,
        pickupCoordinates: raw.pickupCoordinates,
        destinationCoordinates: raw.destinationCoordinates,
        itemName: raw.itemName,
        category: raw.category,
        weightKg: raw.weightKg,
        size: raw.size,
        description: raw.description,
        notes: raw.notes,
        fare: raw.fare,
        estimatedDistance: raw.estimatedDistance,
        estimatedTime: raw.estimatedTime,
        status: raw.status,
        createdAt: raw.createdAt,
        // Sem telefones / nomes completos na oferta pré-aceite.
    };
};

module.exports.toParcelCaptainDTO = (parcel) => {
    const raw = typeof parcel.toObject === 'function' ? parcel.toObject({ virtuals: true }) : { ...parcel };
    delete raw.deliveryPin;
    return raw;
};

module.exports.updateSettings = async (patch) => {
    const settings = await getSettings();
    const allowed = [
        'baseFare', 'perKm', 'perMinute', 'minimumFare',
        'requireDeliveryPin', 'motoMaxSize', 'motoMaxWeightKg', 'blockIncompatibleMoto',
    ];
    for (const key of allowed) {
        if (patch[key] !== undefined) settings[key] = patch[key];
    }
    if (patch.vehicleSurcharge && typeof patch.vehicleSurcharge === 'object') {
        const current = settings.vehicleSurcharge?.toObject?.() || settings.vehicleSurcharge || {};
        settings.vehicleSurcharge = {
            moto: patch.vehicleSurcharge.moto !== undefined ? patch.vehicleSurcharge.moto : current.moto,
            car: patch.vehicleSurcharge.car !== undefined ? patch.vehicleSurcharge.car : current.car,
        };
    }
    await settings.save();
    return settings;
};

module.exports.skipPassengerReview = async ({ parcelId, user }) => {
    const parcel = await parcelModel.findOne({ _id: parcelId, user, status: 'finished' });
    if (!parcel) throw new Error('PARCEL_NOT_FOUND');
    parcel.passengerReviewSkippedAt = new Date();
    await parcel.save();
    return parcel;
};

module.exports.skipCaptainReview = async ({ parcelId, captain }) => {
    const parcel = await parcelModel.findOne({ _id: parcelId, captain, status: 'finished' });
    if (!parcel) throw new Error('PARCEL_NOT_FOUND');
    parcel.captainReviewSkippedAt = new Date();
    await parcel.save();
    return parcel;
};

module.exports.listParcelsAdmin = async ({ status, limit = 50, skip = 0 } = {}) => {
    const filter = {};
    if (status) filter.status = status;
    const [items, total] = await Promise.all([
        parcelModel.find(filter).populate('user').populate('captain')
            .sort({ createdAt: -1 }).skip(skip).limit(limit),
        parcelModel.countDocuments(filter),
    ]);
    return { items, total };
};

module.exports.adminCancelParcel = async ({ parcelId, reason }) => {
    const parcel = await parcelModel.findById(parcelId);
    if (!parcel) throw new Error('PARCEL_NOT_FOUND');
    // delivered legado também é cancelável pelo admin (safety net).
    if (['finished', 'cancelled'].includes(parcel.status)) {
        throw new Error('PARCEL_NOT_CANCELLABLE');
    }
    const captainId = parcel.captain;
    parcel.status = 'cancelled';
    parcel.cancelledBy = 'admin';
    parcel.cancellationReason = reason || 'Cancelado pelo admin';
    parcel.cancelledAt = new Date();
    pushHistory(parcel, 'cancelled', 'admin');
    await parcel.save();
    if (captainId) {
        await dispatchService.releaseCaptainBusyLock(captainId);
    }
    return parcelModel.findById(parcelId).populate('user').populate('captain');
};

// Prefill helper for UI
module.exports.buildDefaultSender = async (userId) => {
    const user = await userModel.findById(userId);
    if (!user) return { name: '', phone: '' };
    return {
        name: `${user.fullname?.firstname || ''} ${user.fullname?.lastname || ''}`.trim(),
        phone: user.phone || user.mobile || '',
    };
};

module.exports.submitReview = async ({ parcelId, user, rating, comment, issueCategory }) => {
    if (!parcelId || !user || !rating) {
        throw new Error('Parcel id, user and rating are required');
    }

    const parcel = await parcelModel.findOne({ _id: parcelId, user });
    if (!parcel) throw new Error('PARCEL_NOT_FOUND');
    if (parcel.status !== 'finished') throw new Error('Only finished parcels can be reviewed');
    if (!parcel.captain) throw new Error('Parcel has no captain to review');

    const reviewModel = require('../models/review.model');
    const existing = await reviewModel.findOne({
        subjectType: 'parcel',
        subjectId: parcelId,
        user,
        type: 'passenger_to_driver',
    });
    if (existing) throw new Error('Parcel already reviewed');

    const review = await reviewModel.create({
        subjectType: 'parcel',
        subjectId: parcelId,
        user,
        captain: parcel.captain,
        rating,
        comment,
        issueCategory: issueCategory || 'none',
        type: 'passenger_to_driver',
    });

    const captainService = require('./captain.service');
    await captainService.recalculateRating(parcel.captain);
    return review;
};

module.exports.submitCaptainReview = async ({ parcelId, captain, rating, comment }) => {
    if (!parcelId || !captain || !rating) {
        throw new Error('Parcel id, captain and rating are required');
    }

    const parcel = await parcelModel.findOne({ _id: parcelId, captain });
    if (!parcel) throw new Error('PARCEL_NOT_FOUND');
    if (parcel.status !== 'finished') throw new Error('Only finished parcels can be reviewed');

    const reviewModel = require('../models/review.model');
    const existing = await reviewModel.findOne({
        subjectType: 'parcel',
        subjectId: parcelId,
        captain,
        type: 'driver_to_passenger',
    });
    if (existing) throw new Error('Parcel already reviewed');

    const review = await reviewModel.create({
        subjectType: 'parcel',
        subjectId: parcelId,
        user: parcel.user,
        captain,
        rating,
        comment,
        type: 'driver_to_passenger',
    });

    const userService = require('./user.service');
    await userService.recalculateRating(parcel.user);
    return review;
};

module.exports.VALID_ORIGINS_BY_TARGET = VALID_ORIGINS_BY_TARGET;
module.exports.PARCEL_EXPIRATION_MINUTES = PARCEL_EXPIRATION_MINUTES;
module.exports.expireStaleAwaitingParcels = expireStaleAwaitingParcels;
