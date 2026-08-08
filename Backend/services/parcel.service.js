const crypto = require('crypto');
const mongoose = require('mongoose');
const parcelModel = require('../models/parcel.model');
const parcelSettingModel = require('../models/parcelSetting.model');
const globalSettingModel = require('../models/globalSetting.model');
const mapService = require('./maps.service');
const dispatchService = require('./dispatch.service');
const userModel = require('../models/user.model');
const { CAPTAIN_IDENTITY_FIELDS, USER_IDENTITY_FIELDS } = require('../utils/identityPopulate');
const { computeOfferExpiresAt } = require('../config/offerPolicy');
const { getCache, setCache, deleteCache } = require('../cache/cache');

const ALLOWED_PAYMENT_METHODS = ['cash', 'pix'];

const SIZE_RANK = { small: 1, medium: 2, large: 3 };

// Máquina de estados atômica (auditoria concorrência encomendas, 2026-08-04).
// finished/cancelled nunca são origem — terminais sob corrida.
const VALID_ORIGINS_BY_TARGET = {
    going_to_pickup: ['provider_accepted'],
    arrived_pickup: ['going_to_pickup'],
    collected: ['arrived_pickup'],
    in_transit: ['collected'],
    arrived_destination: ['in_transit'],
    finished: ['arrived_destination'],
    // Passageiro: só até chegou na retirada (antes da coleta).
    cancelled: [
        'scheduled',
        'awaiting_provider',
        'provider_accepted',
        'going_to_pickup',
        'arrived_pickup',
    ],
};

// Admin/system: pode cancelar em qualquer estado não-terminal (inclui legado delivered).
const CANCEL_ORIGINS_FORCE = [
    'scheduled',
    'awaiting_provider',
    'provider_accepted',
    'going_to_pickup',
    'arrived_pickup',
    'collected',
    'in_transit',
    'arrived_destination',
    'delivered',
];

const PARCEL_EXPIRATION_MINUTES = 10;

/**
 * Transição atômica de status. Retorna null se perdeu a corrida (origem inválida /
 * filtro extra). Espelha transitionRide do ride.service.
 */
async function transitionParcel(
    parcelId,
    toStatus,
    extraFilter = {},
    extraSet = {},
    by = 'system',
    { originsOverride } = {}
) {
    const origins = originsOverride || VALID_ORIGINS_BY_TARGET[toStatus];
    if (!origins) {
        throw new Error('INVALID_STATUS_TRANSITION');
    }
    return parcelModel.findOneAndUpdate(
        { _id: parcelId, status: { $in: origins }, ...extraFilter },
        {
            $set: { status: toStatus, ...extraSet },
            $push: { statusHistory: { status: toStatus, at: new Date(), by } },
        },
        { new: true }
    );
}

function parcelExpirationCutoff() {
    return new Date(Date.now() - PARCEL_EXPIRATION_MINUTES * 60 * 1000);
}

/** Cancela awaiting_provider expirados (lazy, espelha ride getCurrent). */
async function expireStaleAwaitingParcels({ userId } = {}) {
    const cutoff = parcelExpirationCutoff();
    // SCH-C2: pós-ativação usa activatedAt; imediata (sem activatedAt) usa createdAt.
    const filter = {
        status: 'awaiting_provider',
        $or: [
            { activatedAt: { $type: 'date', $lt: cutoff } },
            {
                $and: [
                    { $or: [{ activatedAt: null }, { activatedAt: { $exists: false } }] },
                    { createdAt: { $lt: cutoff } },
                ],
            },
        ],
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

const DEFAULT_VEHICLE_PRICING = {
    moto: {
        baseFare: 6,
        perKm: 1.8,
        perMinute: 0.35,
        minimumFare: 8,
        maxWeightKg: 10,
        maxPackageSize: 'medium',
        requireDeliveryPin: true,
        blockIncompatibleVehicle: true,
    },
    car: {
        baseFare: 10,
        perKm: 1.8,
        perMinute: 0.35,
        minimumFare: 12,
        maxWeightKg: 50,
        maxPackageSize: 'large',
        requireDeliveryPin: true,
        blockIncompatibleVehicle: true,
    },
};

function pricingToPlain(p) {
    if (!p) return null;
    const o = typeof p.toObject === 'function' ? p.toObject() : { ...p };
    return {
        baseFare: Number(o.baseFare),
        perKm: Number(o.perKm),
        perMinute: Number(o.perMinute),
        minimumFare: Number(o.minimumFare),
        maxWeightKg: Number(o.maxWeightKg),
        maxPackageSize: o.maxPackageSize || 'medium',
        requireDeliveryPin: o.requireDeliveryPin !== false,
        blockIncompatibleVehicle: o.blockIncompatibleVehicle !== false,
    };
}

/** Migra doc legado (tarifa global + surcharge) → deliveryPricing.moto/car. */
function buildPricingFromLegacy(settings) {
    const base = Number(settings.baseFare ?? DEFAULT_VEHICLE_PRICING.moto.baseFare);
    const perKm = Number(settings.perKm ?? DEFAULT_VEHICLE_PRICING.moto.perKm);
    const perMinute = Number(settings.perMinute ?? DEFAULT_VEHICLE_PRICING.moto.perMinute);
    const minimumFare = Number(settings.minimumFare ?? DEFAULT_VEHICLE_PRICING.moto.minimumFare);
    const surchargeMoto = Number(settings.vehicleSurcharge?.moto ?? 0);
    const surchargeCar = Number(settings.vehicleSurcharge?.car ?? 4);
    const pin = settings.requireDeliveryPin !== false;

    return {
        moto: {
            baseFare: base + surchargeMoto,
            perKm,
            perMinute,
            minimumFare,
            maxWeightKg: Number(settings.motoMaxWeightKg ?? 10),
            maxPackageSize: settings.motoMaxSize || 'medium',
            requireDeliveryPin: pin,
            blockIncompatibleVehicle: settings.blockIncompatibleMoto !== false,
        },
        car: {
            baseFare: base + surchargeCar,
            perKm,
            perMinute,
            minimumFare: Math.max(minimumFare, base + surchargeCar),
            maxWeightKg: DEFAULT_VEHICLE_PRICING.car.maxWeightKg,
            maxPackageSize: DEFAULT_VEHICLE_PRICING.car.maxPackageSize,
            requireDeliveryPin: pin,
            blockIncompatibleVehicle: true,
        },
    };
}

function hasUsableVehiclePricing(block) {
    const p = pricingToPlain(block);
    return p && Number.isFinite(p.baseFare) && Number.isFinite(p.perKm);
}

/**
 * Garante deliveryPricing.moto/car (migração lazy).
 *
 * - pricingVersion >= 2: usa nested como fonte de verdade.
 * - pricingVersion < 2 com nested já alinhado ao top-level: promove sem rebuild
 *   (preserva carro com perKm/minutos próprios já salvos pelo admin).
 * - nested só com defaults do schema enquanto top-level diverge: rebuild do legado.
 */
async function ensureDeliveryPricing(settings) {
    const version = Number(settings.pricingVersion) || 1;
    const raw = settings.deliveryPricing?.toObject?.() || settings.deliveryPricing || {};
    const motoOk = hasUsableVehiclePricing(raw.moto);
    const carOk = hasUsableVehiclePricing(raw.car);

    if (version >= 2 && motoOk && carOk) return settings;

    const nestedMoto = motoOk ? pricingToPlain(raw.moto) : null;
    const nestedCar = carOk ? pricingToPlain(raw.car) : null;
    const topBase = Number(settings.baseFare);
    const topKm = Number(settings.perKm);

    const nestedLooksLikeSchemaDefaults = nestedMoto
        && nestedMoto.baseFare === DEFAULT_VEHICLE_PRICING.moto.baseFare
        && nestedMoto.perKm === DEFAULT_VEHICLE_PRICING.moto.perKm
        && Number.isFinite(topBase)
        && topBase !== nestedMoto.baseFare;

    const nestedAlignedWithTop = nestedMoto
        && (!Number.isFinite(topBase) || topBase === nestedMoto.baseFare)
        && (!Number.isFinite(topKm) || topKm === nestedMoto.perKm);

    if (motoOk && carOk && nestedAlignedWithTop && !nestedLooksLikeSchemaDefaults) {
        settings.deliveryPricing = { moto: nestedMoto, car: nestedCar };
        settings.pricingVersion = 2;
        settings.markModified('deliveryPricing');
        await settings.save();
        return settings;
    }

    const migrated = buildPricingFromLegacy(settings);
    settings.deliveryPricing = {
        moto: version >= 2 && motoOk ? nestedMoto : migrated.moto,
        car: version >= 2 && carOk ? nestedCar : migrated.car,
    };

    const moto = pricingToPlain(settings.deliveryPricing.moto);
    settings.baseFare = moto.baseFare;
    settings.perKm = moto.perKm;
    settings.perMinute = moto.perMinute;
    settings.minimumFare = moto.minimumFare;
    settings.requireDeliveryPin = moto.requireDeliveryPin;
    settings.motoMaxWeightKg = moto.maxWeightKg;
    settings.motoMaxSize = moto.maxPackageSize;
    settings.blockIncompatibleMoto = moto.blockIncompatibleVehicle;
    settings.pricingVersion = 2;
    settings.markModified('deliveryPricing');
    await settings.save();
    return settings;
}

function resolveVehiclePricing(settings, vehicleType) {
    const key = vehicleType === 'car' ? 'car' : 'moto';
    const block = settings.deliveryPricing?.[key];
    if (hasUsableVehiclePricing(block)) {
        return pricingToPlain(block);
    }
    // Fallback extremo (não deveria ocorrer após ensureDeliveryPricing)
    const legacy = buildPricingFromLegacy(settings);
    return legacy[key];
}

// Auditoria de cache (2026-08-08, A6): singleton lido em validateVehicleCompatibility,
// getParcelFare e confirmDelivery — um fluxo cotação→criação de encomenda lia o
// mesmo documento 4x. TTL 600s (10min), mesmo padrão de VehicleCategory/TariffSetting
// pra dado administrativo estático. Invalidado em updateSettings (mesmo arquivo).
const PARCEL_SETTING_CACHE_KEY = 'parcel-setting:singleton';

async function getSettings() {
    const cached = getCache(PARCEL_SETTING_CACHE_KEY);
    if (cached) return cached;

    let settings = await parcelSettingModel.findOne().sort({ updatedAt: -1 });
    if (!settings) {
        settings = await parcelSettingModel.create({
            deliveryPricing: DEFAULT_VEHICLE_PRICING,
            pricingVersion: 2,
            baseFare: DEFAULT_VEHICLE_PRICING.moto.baseFare,
            perKm: DEFAULT_VEHICLE_PRICING.moto.perKm,
            perMinute: DEFAULT_VEHICLE_PRICING.moto.perMinute,
            minimumFare: DEFAULT_VEHICLE_PRICING.moto.minimumFare,
        });
    } else {
        settings = await ensureDeliveryPricing(settings);
    }
    setCache(PARCEL_SETTING_CACHE_KEY, settings, 600);
    return settings;
}

module.exports.resolveVehiclePricing = resolveVehiclePricing;
module.exports.DEFAULT_VEHICLE_PRICING = DEFAULT_VEHICLE_PRICING;

function generateDeliveryPin() {
    return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

function pushHistory(parcel, status, by = 'system') {
    parcel.statusHistory = parcel.statusHistory || [];
    parcel.statusHistory.push({ status, at: new Date(), by });
}

module.exports.validateVehicleCompatibility = async ({ vehicleType, size, weightKg }) => {
    const settings = await getSettings();
    if (!['moto', 'car'].includes(vehicleType)) {
        return { warnings: ['Tipo de veículo inválido'], blocked: true, settings };
    }

    const pricing = resolveVehiclePricing(settings, vehicleType);
    const warnings = [];
    const label = vehicleType === 'moto' ? 'moto' : 'carro';
    const alt = vehicleType === 'moto' ? 'carro' : 'moto';

    const maxRank = SIZE_RANK[pricing.maxPackageSize] || 2;
    const sizeRank = SIZE_RANK[size] || 1;
    if (sizeRank > maxRank) {
        warnings.push(`Item grande demais para ${label} — recomendamos ${alt}.`);
    }
    if (Number(weightKg) > Number(pricing.maxWeightKg)) {
        warnings.push(`Peso acima de ${pricing.maxWeightKg} kg para ${label} — recomendamos ${alt}.`);
    }

    const blocked = Boolean(pricing.blockIncompatibleVehicle) && warnings.length > 0;
    return { warnings, blocked, settings, pricing };
};

module.exports.getParcelFare = async ({ pickup, destination, vehicleType }) => {
    if (!pickup || !destination || !vehicleType) {
        throw new Error('pickup, destination e vehicleType são obrigatórios');
    }
    if (!['moto', 'car'].includes(vehicleType)) {
        throw new Error('vehicleType inválido');
    }

    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    const distanceM = distanceTime.distance.value;
    const durationS = distanceTime.duration.value;

    const PricingEngine = require('./pricingEngine.service');
    const pricingSnapshot = await PricingEngine.buildConfigSnapshot({
        vehicleType,
        serviceKind: 'parcel',
    });

    const pricing = await PricingEngine.calculateFare({
        distance: distanceM,
        time: durationS,
        vehicleType,
        paymentMethod: 'cash', // Default para estimativa inicial
        configSnapshot: pricingSnapshot,
        serviceKind: 'parcel',
    });

    // Anexar limites físicos do parcelSetting (mantidos para restrição, não para preço)
    const settings = await getSettings();
    const parcelPricing = resolveVehiclePricing(settings, vehicleType);
    pricingSnapshot.maxWeightKg = parcelPricing.maxWeightKg;
    pricingSnapshot.maxPackageSize = parcelPricing.maxPackageSize;
    pricingSnapshot.requireDeliveryPin = parcelPricing.requireDeliveryPin;
    pricingSnapshot.blockIncompatibleVehicle = parcelPricing.blockIncompatibleVehicle;

    return {
        fare: pricing.finalFare,
        estimatedDistance: distanceM,
        estimatedTime: durationS,
        commissionPercent: pricing.commissionPercent,
        commissionAmount: pricing.commissionAmount,
        fareBreakdown: pricing.fareBreakdown,
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
        scheduledAt = null,
    } = payload;

    if (!user || !pickup || !destination || !vehicleType || !sender || !recipient) {
        throw new Error('Campos obrigatórios ausentes');
    }

    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
        const err = new Error('INVALID_PAYMENT_METHOD');
        err.code = 'INVALID_PAYMENT_METHOD';
        throw err;
    }

    let parsedSchedule = null;
    if (scheduledAt) {
        const scheduleService = require('./schedule.service');
        parsedSchedule = scheduleService.assertValidScheduledAt(scheduledAt);
    }

    // Agendamento futuro não conflita com corrida/encomenda ativa imediata.
    if (!parsedSchedule) {
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

    {
        const serviceKind = parsedSchedule ? 'scheduledParcel' : 'parcel';
        if (!(await dispatchService.isVehicleCategoryAllowed(vehicleType, serviceKind))) {
            const err = new Error('VEHICLE_CATEGORY_NOT_ALLOWED_FOR_SERVICE');
            err.code = 'VEHICLE_CATEGORY_NOT_ALLOWED_FOR_SERVICE';
            throw err;
        }
    }

    const fareData = await module.exports.getParcelFare({ pickup, destination, vehicleType });
    let destinationCoordinates;
    let pickupCoordinates;
    try {
        const dest = await mapService.getAddressCoordinate(destination);
        destinationCoordinates = { lat: dest.ltd, lng: dest.lng };
    } catch {
        destinationCoordinates = undefined;
    }
    // Agendadas: coords de coleta cedo para upcoming por raio (SCH-C3).
    if (parsedSchedule) {
        try {
            const pick = await mapService.getAddressCoordinate(pickup);
            pickupCoordinates = { lat: pick.ltd, lng: pick.lng };
        } catch {
            pickupCoordinates = undefined;
        }
    }

    const deliveryPin = generateDeliveryPin();
    let parcel;
    try {
        parcel = await parcelModel.create({
            user,
            vehicleType,
            pickup,
            destination,
            pickupCoordinates,
            destinationCoordinates,
            sender,
            recipient,
            itemName,
            category,
            weightKg,
            size,
            description,
            notes,
            schedule: parsedSchedule
                ? { mode: 'later', at: parsedSchedule }
                : { mode: 'now', at: null },
            scheduledAt: parsedSchedule,
            fare: fareData.fare,
            estimatedDistance: fareData.estimatedDistance,
            estimatedTime: fareData.estimatedTime,
            fareBreakdown: fareData.fareBreakdown,
            pricingSnapshot: fareData.pricingSnapshot,
            commissionPercent: fareData.commissionPercent,
            commissionAmount: fareData.commissionAmount,
            deliveryPin,
            status: parsedSchedule ? 'scheduled' : 'awaiting_provider',
            statusHistory: [{
                status: parsedSchedule ? 'scheduled' : 'awaiting_provider',
                at: new Date(),
                by: 'user',
            }],
            photos: { pickupUrl: null, deliveryUrl: null },
            paymentMethod,
            paymentStatus: 'pending',
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
        ).populate('user', USER_IDENTITY_FIELDS).populate('captain', CAPTAIN_IDENTITY_FIELDS);

        if (!updated) throw new Error('PARCEL_ALREADY_ACCEPTED');
        return updated;
    } catch (err) {
        await dispatchService.releaseCaptainBusyLock(freshCaptain._id);
        if (err.code === 11000) throw new Error('CAPTAIN_HAS_ACTIVE_PARCEL');
        throw err;
    }
};

module.exports.updateParcelStatus = async ({ parcelId, captain, status }) => {
    if (!VALID_ORIGINS_BY_TARGET[status] || status === 'cancelled' || status === 'finished') {
        throw new Error('INVALID_STATUS_TRANSITION');
    }

    const updated = await transitionParcel(
        parcelId,
        status,
        { captain: captain._id },
        {},
        'captain'
    );
    if (!updated) {
        const exists = await parcelModel.exists({ _id: parcelId, captain: captain._id });
        if (!exists) throw new Error('PARCEL_NOT_FOUND');
        throw new Error('INVALID_STATUS_TRANSITION');
    }

    return parcelModel.findById(parcelId)
        .populate('user', USER_IDENTITY_FIELDS)
        .populate('captain', CAPTAIN_IDENTITY_FIELDS);
};

module.exports.confirmDelivery = async ({ parcelId, captain, pin }) => {
    const settings = await getSettings();
    const parcel = await parcelModel.findOne({ _id: parcelId, captain: captain._id }).select('+deliveryPin');
    if (!parcel) throw new Error('PARCEL_NOT_FOUND');
    if (parcel.status !== 'arrived_destination') {
        throw new Error('INVALID_STATUS_FOR_DELIVERY');
    }

    const vehiclePricing = resolveVehiclePricing(settings, parcel.vehicleType || 'moto');
    if (vehiclePricing.requireDeliveryPin) {
        if (!pin || String(pin) !== String(parcel.deliveryPin)) {
            throw new Error('INVALID_PIN');
        }
    }

    const now = new Date();
    // Mantém histórico delivered+finished; filtro atômico evita corrida com cancel.
    // paymentStatus fica pending — liquidação da comissão é confirmParcelPayment.
    const updated = await parcelModel.findOneAndUpdate(
        { _id: parcelId, captain: captain._id, status: 'arrived_destination' },
        {
            $set: { status: 'finished', paymentStatus: 'pending' },
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
    ).populate('user', USER_IDENTITY_FIELDS).populate('captain', CAPTAIN_IDENTITY_FIELDS);

    if (!updated) throw new Error('INVALID_STATUS_FOR_DELIVERY');

    await dispatchService.releaseCaptainBusyLockIfIdle(captain._id);
    return updated;
};

/**
 * Liquidação cash/pix da encomenda (espelha confirmPaymentReceived das corridas):
 * passageiro pagou o motorista fora do app; plataforma debita só a comissão na wallet.
 * Idempotente via claim atômico de paymentStatus + índice único em transaction.
 */
module.exports.confirmParcelPayment = async ({ parcelId, captain }) => {
    if (!parcelId) throw new Error('PARCEL_ID_REQUIRED');
    if (!captain?._id) throw new Error('CAPTAIN_REQUIRED');

    const walletService = require('./wallet.service');
    const captainModel = require('../models/captain.model');

    const session = await mongoose.startSession();
    let sideEffectCallbacks = [];

    try {
        await session.withTransaction(async () => {
            sideEffectCallbacks = [];

            const existing = await parcelModel.findOne({
                _id: parcelId,
                captain: captain._id,
            }).session(session);

            if (!existing) throw new Error('PARCEL_NOT_FOUND');
            if (existing.status !== 'finished') throw new Error('PARCEL_NOT_FINISHED');
            if (existing.paymentStatus === 'paid') throw new Error('PAYMENT_ALREADY_CONFIRMED');
            if (!ALLOWED_PAYMENT_METHODS.includes(existing.paymentMethod)) {
                throw new Error('INVALID_PAYMENT_METHOD');
            }

            const claimed = await parcelModel.findOneAndUpdate(
                {
                    _id: parcelId,
                    captain: captain._id,
                    status: 'finished',
                    paymentStatus: { $ne: 'paid' },
                },
                { $set: { paymentStatus: 'paid' } },
                { new: true, session }
            );
            if (!claimed) throw new Error('PAYMENT_ALREADY_CONFIRMED');

            const fare = claimed.fare || 0;
            const commissionAmount = claimed.commissionAmount || 0;
            const commissionPercent = claimed.commissionPercent || 0;
            const shortId = claimed._id.toString().slice(-6);

            const paymentResult = await walletService.createTransaction({
                captainId: captain._id,
                parcelId: claimed._id,
                type: 'parcel_payment',
                paymentMethod: claimed.paymentMethod,
                amount: fare,
                description: `Encomenda #${shortId} (${claimed.paymentMethod})`,
                session,
            });
            sideEffectCallbacks.push(paymentResult.applySideEffects);

            if (commissionAmount > 0) {
                const commissionResult = await walletService.createTransaction({
                    captainId: captain._id,
                    parcelId: claimed._id,
                    type: 'commission',
                    paymentMethod: 'wallet',
                    amount: commissionAmount,
                    description: `Comissão encomenda #${shortId} (${commissionPercent}%)`,
                    session,
                });
                sideEffectCallbacks.push(commissionResult.applySideEffects);
            }

            await captainModel.findByIdAndUpdate(captain._id, {
                $inc: { earnings: fare },
            }, { session });

            if (existing.user) {
                await userModel.findByIdAndUpdate(existing.user, {
                    $inc: { totalSpent: fare },
                }, { session });
            }
        });
    } finally {
        await session.endSession();
    }

    for (const applySideEffects of sideEffectCallbacks) {
        await applySideEffects();
    }

    return parcelModel.findById(parcelId)
        .populate('user', USER_IDENTITY_FIELDS)
        .populate('captain', CAPTAIN_IDENTITY_FIELDS);
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
        await dispatchService.releaseCaptainBusyLockIfIdle(updated.captain._id || updated.captain);
    }
    return updated;
};

module.exports.cancelParcel = async ({ parcelId, user, reason, by = 'passenger' }) => {
    const historyBy = by === 'passenger' ? 'user' : by;
    const updated = await transitionParcel(
        parcelId,
        'cancelled',
        { user },
        {
            cancelledBy: by,
            cancellationReason: reason || '',
            cancelledAt: new Date(),
        },
        historyBy
    );
    if (!updated) {
        const exists = await parcelModel.exists({ _id: parcelId, user });
        if (!exists) throw new Error('PARCEL_NOT_FOUND');
        throw new Error('PARCEL_NOT_CANCELLABLE');
    }

    // Só libera lock se a transição venceu e o motorista ficou ocioso.
    if (updated.captain) {
        await dispatchService.releaseCaptainBusyLockIfIdle(updated.captain);
    }

    return parcelModel.findById(parcelId).populate('user').populate('captain');
};

/** Cancelamento interno (ex.: falha de despacho após create). */
module.exports.cancelParcelSystem = async (parcelId, reason = 'dispatch_failed') => {
    const existing = await parcelModel.findById(parcelId).select('status captain');
    if (!existing) return null;
    if (['finished', 'cancelled'].includes(existing.status)) return existing;

    const updated = await transitionParcel(
        parcelId,
        'cancelled',
        {},
        {
            cancelledBy: 'system',
            cancellationReason: reason,
            cancelledAt: new Date(),
        },
        'system',
        { originsOverride: CANCEL_ORIGINS_FORCE }
    );
    if (!updated) {
        // Outra operação venceu (ex.: accept/finish) — não mexer no lock.
        return parcelModel.findById(parcelId).populate('user').populate('captain');
    }

    if (updated.captain) {
        await dispatchService.releaseCaptainBusyLockIfIdle(updated.captain);
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
    }).populate('captain', CAPTAIN_IDENTITY_FIELDS).select('+deliveryPin').sort({ createdAt: -1 });
    if (current) return current;

    // Após finalização, mantém na tela de avaliação até o passageiro avaliar ou pular
    const finished = await parcelModel.findOne({
        user: userId,
        status: 'finished',
        $or: [
            { passengerReviewSkippedAt: null },
            { passengerReviewSkippedAt: { $exists: false } },
        ],
    }).populate('captain', CAPTAIN_IDENTITY_FIELDS).select('+deliveryPin').sort({ createdAt: -1 });
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
    }).populate('user', USER_IDENTITY_FIELDS).sort({ createdAt: -1 });
    if (active) return active;

    // Cobrança pendente tem prioridade sobre avaliação (não some do current sem liquidar).
    const unpaid = await parcelModel.findOne({
        captain: captainId,
        status: 'finished',
        paymentStatus: { $ne: 'paid' },
    }).populate('user', USER_IDENTITY_FIELDS).sort({ createdAt: -1 });
    if (unpaid) return unpaid;

    // Rating pós-entrega: finished sem avaliação do motorista (sobrevive refresh).
    const finished = await parcelModel.findOne({
        captain: captainId,
        status: 'finished',
        paymentStatus: 'paid',
        $or: [
            { captainReviewSkippedAt: null },
            { captainReviewSkippedAt: { $exists: false } },
        ],
    }).populate('user', USER_IDENTITY_FIELDS).sort({ createdAt: -1 });
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

/**
 * Lista para a tela Encomendas do motorista:
 * - ofertas ainda sem aceite (mesmo critério do despacho);
 * - encomenda ativa do motorista;
 * - histórico finished/cancelled do motorista (paginado).
 */
module.exports.getCaptainParcelHistory = async ({ captain, page = 1, limit = 20 }) => {
    if (!captain) throw new Error('Captain is required');

    const captainId = captain._id || captain;
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (safePage - 1) * safeLimit;

    const activeParcel = await module.exports.getCurrentParcelForCaptain(captainId);

    let pendingOffers = [];
    try {
        pendingOffers = await module.exports.getPendingParcelsForCaptain({ captain });
    } catch {
        pendingOffers = [];
    }

    const historyQuery = {
        captain: captainId,
        status: { $in: ['finished', 'cancelled'] },
    };

    const [total, parcels] = await Promise.all([
        parcelModel.countDocuments(historyQuery),
        parcelModel.find(historyQuery)
            .populate('user', 'fullname phone email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(safeLimit)
            .select('-deliveryPin'),
    ]);

    return {
        activeParcel: activeParcel ? module.exports.toParcelCaptainDTO(activeParcel) : null,
        pendingOffers,
        parcels: (parcels || []).map((p) => module.exports.toParcelCaptainDTO(p)),
        page: safePage,
        limit: safeLimit,
        total,
        hasNext: (skip + safeLimit) < total,
    };
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
    if (!vehicleType) return [];
    if (!(await dispatchService.isVehicleCategoryAllowed(vehicleType, 'parcel'))) return [];

    const position = freshCaptain.location;
    if (!position || position.ltd == null || position.lng == null) return [];

    await expireStaleAwaitingParcels();

    const cutoff = parcelExpirationCutoff();
    // SCH-C2: agendada ativada → activatedAt; imediata (activatedAt null) → createdAt.
    const candidates = await parcelModel.find({
        status: 'awaiting_provider',
        vehicleType,
        $or: [
            { activatedAt: { $gte: cutoff } },
            { activatedAt: null, createdAt: { $gte: cutoff } },
        ],
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
    const { computeDriverAmount } = require('../utils/financePrivacy');
    const driverAmount = computeDriverAmount(raw);
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
        // Oferta: valor que o passageiro paga + líquido (sem comissão/%).
        fare: raw.fare,
        driverAmount,
        estimatedDistance: raw.estimatedDistance,
        estimatedTime: raw.estimatedTime,
        status: raw.status,
        createdAt: raw.createdAt,
        paymentMethod: raw.paymentMethod,
        // Auditoria PWA (2026-08-07, P1): só enquanto ainda é uma oferta em aberto —
        // espelha toCaptainRideResponse (ride.controller.js).
        ...(raw.status === 'awaiting_provider' ? { offerExpiresAt: computeOfferExpiresAt(raw) } : {}),
        // Sem telefones / nomes completos na oferta pré-aceite.
    };
};

module.exports.toParcelCaptainDTO = (parcel) => {
    const { sanitizeCaptainFinance } = require('../utils/financePrivacy');
    const raw = sanitizeCaptainFinance(parcel);
    delete raw.deliveryPin;
    return raw;
};

function mergeVehiclePricing(current, patch) {
    const base = pricingToPlain(current) || { ...DEFAULT_VEHICLE_PRICING.moto };
    if (!patch || typeof patch !== 'object') return base;
    const next = { ...base };
    for (const key of Object.keys(DEFAULT_VEHICLE_PRICING.moto)) {
        if (patch[key] !== undefined && patch[key] !== null && patch[key] !== '') {
            if (typeof base[key] === 'boolean') {
                next[key] = Boolean(patch[key]);
            } else if (key === 'maxPackageSize') {
                next[key] = ['small', 'medium', 'large'].includes(patch[key]) ? patch[key] : base[key];
            } else {
                const n = Number(patch[key]);
                if (Number.isFinite(n)) next[key] = n;
            }
        }
    }
    return next;
}

module.exports.updateSettings = async (patch = {}) => {
    const settings = await getSettings();

    // Preferência: deliveryPricing por veículo (fonte de verdade).
    if (patch.deliveryPricing && typeof patch.deliveryPricing === 'object') {
        const current = settings.deliveryPricing?.toObject?.() || settings.deliveryPricing || {};
        const moto = mergeVehiclePricing(current.moto, patch.deliveryPricing.moto);
        const car = mergeVehiclePricing(current.car, patch.deliveryPricing.car);
        settings.deliveryPricing = { moto, car };
        settings.markModified('deliveryPricing');
    }

    // Compat: patch legado top-level atualiza moto (e opcionalmente car via surcharge).
    const legacyKeys = ['baseFare', 'perKm', 'perMinute', 'minimumFare', 'requireDeliveryPin', 'motoMaxSize', 'motoMaxWeightKg', 'blockIncompatibleMoto'];
    const hasLegacy = legacyKeys.some((k) => patch[k] !== undefined);
    if (hasLegacy && !patch.deliveryPricing) {
        const current = settings.deliveryPricing?.toObject?.() || settings.deliveryPricing || {};
        const motoPatch = {
            baseFare: patch.baseFare,
            perKm: patch.perKm,
            perMinute: patch.perMinute,
            minimumFare: patch.minimumFare,
            requireDeliveryPin: patch.requireDeliveryPin,
            maxPackageSize: patch.motoMaxSize,
            maxWeightKg: patch.motoMaxWeightKg,
            blockIncompatibleVehicle: patch.blockIncompatibleMoto,
        };
        const moto = mergeVehiclePricing(current.moto, motoPatch);
        let car = pricingToPlain(current.car) || { ...DEFAULT_VEHICLE_PRICING.car };
        if (patch.vehicleSurcharge?.car !== undefined || patch.baseFare !== undefined) {
            const surcharge = Number(
                patch.vehicleSurcharge?.car ?? settings.vehicleSurcharge?.car ?? 4
            );
            car = {
                ...car,
                baseFare: Number(moto.baseFare) + surcharge,
                perKm: moto.perKm,
                perMinute: moto.perMinute,
            };
        }
        settings.deliveryPricing = { moto, car };
        settings.markModified('deliveryPricing');
    }

    // Sync campos legados ← moto (compatibilidade)
    const moto = resolveVehiclePricing(settings, 'moto');
    settings.baseFare = moto.baseFare;
    settings.perKm = moto.perKm;
    settings.perMinute = moto.perMinute;
    settings.minimumFare = moto.minimumFare;
    settings.requireDeliveryPin = moto.requireDeliveryPin;
    settings.motoMaxWeightKg = moto.maxWeightKg;
    settings.motoMaxSize = moto.maxPackageSize;
    settings.blockIncompatibleMoto = moto.blockIncompatibleVehicle;
    settings.vehicleSurcharge = {
        moto: 0,
        car: Math.max(0, resolveVehiclePricing(settings, 'car').baseFare - moto.baseFare),
    };
    settings.pricingVersion = 2;

    await settings.save();
    // Auditoria de cache (2026-08-08, A6): invalida o singleton — getSettings()
    // já retornaria o mesmo objeto mutado em memória (useClones:false), mas
    // invalidar explicitamente é o padrão usado em todo o resto desta auditoria.
    deleteCache(PARCEL_SETTING_CACHE_KEY);
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
    if (parcel.paymentStatus !== 'paid') throw new Error('PAYMENT_NOT_CONFIRMED');
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
    const exists = await parcelModel.exists({ _id: parcelId });
    if (!exists) throw new Error('PARCEL_NOT_FOUND');

    const updated = await transitionParcel(
        parcelId,
        'cancelled',
        {},
        {
            cancelledBy: 'admin',
            cancellationReason: reason || 'Cancelado pelo admin',
            cancelledAt: new Date(),
        },
        'admin',
        { originsOverride: CANCEL_ORIGINS_FORCE }
    );
    if (!updated) {
        throw new Error('PARCEL_NOT_CANCELLABLE');
    }

    if (updated.captain) {
        await dispatchService.releaseCaptainBusyLockIfIdle(updated.captain);
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
module.exports.transitionParcel = transitionParcel;
module.exports.CANCEL_ORIGINS_FORCE = CANCEL_ORIGINS_FORCE;
module.exports.PARCEL_EXPIRATION_MINUTES = PARCEL_EXPIRATION_MINUTES;
module.exports.expireStaleAwaitingParcels = expireStaleAwaitingParcels;
