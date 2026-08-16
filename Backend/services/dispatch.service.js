const mapService = require('./maps.service');
const rideModel = require('../models/ride.model');
const { getCachedVehicleCategoryByName } = require('./vehicleCategoryCache.service');
const {
    authorizationAllowsFamily,
    deriveLegacyAuthorization,
    isCaptainAuthorizedForVehicleType,
    vehicleFamilyFromCategory,
} = require('./vehicleAuthorization.service');
const { CAPTAIN_SEARCH_RADIUS_KM } = require('../config/dispatchPolicy');

const ACTIVE_RIDE_STATUSES = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started'];
const ACTIVE_PARCEL_STATUSES = [
    'provider_accepted',
    'going_to_pickup',
    'arrived_pickup',
    'collected',
    'in_transit',
    'arrived_destination',
];

/** Match de autorização do ADM; categoria desconhecida conserva o match legado estrito. */
function filterCaptainsByVehicleType(captains, vehicleType, { excludeCaptainId, TRACE_ID = '[AUDIT]', category } = {}) {
    const requestedFamily = vehicleFamilyFromCategory(category || vehicleType);
    return captains.filter((captain) => {
        if (excludeCaptainId && captain._id.toString() === excludeCaptainId.toString()) {
            return false;
        }
        const authorization = deriveLegacyAuthorization(captain);
        const capType = captain.vehicle?.vehicleType;
        const isMatch = requestedFamily && authorization
            ? authorizationAllowsFamily(authorization, requestedFamily)
            : capType === vehicleType;
        if (!isMatch) {
            console.log(`[AUDIT][${TRACE_ID}] Captain ${captain._id} reprovado (Autorização incompatível: ${authorization || capType || 'não definida'} != ${requestedFamily || vehicleType})`);
        }
        return isMatch;
    });
}

async function captainHasActiveRide(captainId) {
    if (!captainId) return false;
    const hit = await rideModel.exists({
        captain: captainId,
        status: { $in: ACTIVE_RIDE_STATUSES },
    });
    return Boolean(hit);
}

async function captainHasActiveParcel(captainId) {
    if (!captainId) return false;
    // Lazy require evita ciclo no boot enquanto parcel.model ainda sobe.
    const parcelModel = require('../models/parcel.model');
    const hit = await parcelModel.exists({
        captain: captainId,
        status: { $in: ACTIVE_PARCEL_STATUSES },
    });
    return Boolean(hit);
}

/** Lock atômico cruzado ride↔parcel no accept. */
async function acquireCaptainBusyLock(captainId) {
    if (!captainId) return false;
    const captainModel = require('../models/captain.model');
    const locked = await captainModel.findOneAndUpdate(
        {
            _id: captainId,
            $or: [
                { busyLock: { $exists: false } },
                { busyLock: false },
                { busyLock: null },
            ],
        },
        { $set: { busyLock: true } },
        { new: true }
    );
    return Boolean(locked);
}

async function releaseCaptainBusyLock(captainId) {
    if (!captainId) return;
    const captainModel = require('../models/captain.model');
    await captainModel.findByIdAndUpdate(captainId, { $set: { busyLock: false } });
}

/** Só libera busyLock se o motorista não tem ride nem parcel ativos. */
async function releaseCaptainBusyLockIfIdle(captainId) {
    if (!captainId) return false;
    if (await captainHasActiveRide(captainId)) return false;
    if (await captainHasActiveParcel(captainId)) return false;
    await releaseCaptainBusyLock(captainId);
    return true;
}

/**
 * Remove captains que já têm trabalho ativo (ride ou parcel), conforme flags.
 * Exclusão mútua: quem tem corrida ativa não recebe encomenda e vice-versa.
 */
async function filterCaptainsWithoutActiveWork(captains, { excludeActiveRide = true, excludeActiveParcel = true } = {}) {
    const results = [];
    for (const captain of captains) {
        if (captain.busyLock === true) continue;
        if (excludeActiveRide && (await captainHasActiveRide(captain._id))) continue;
        if (excludeActiveParcel && (await captainHasActiveParcel(captain._id))) continue;
        results.push(captain);
    }
    return results;
}

async function isVehicleCategoryAllowed(vehicleType, serviceKind) {
    if (!vehicleType || !serviceKind) return false;
    const fieldByKind = { ride: 'ride', parcel: 'parcel', scheduledRide: 'scheduledRide', scheduledParcel: 'scheduledParcel' };
    const field = fieldByKind[serviceKind];
    if (!field) return false;
    // Auditoria de cache (2026-08-08, A3): chamado por captain no despacho (uma vez
    // por tipo de veículo único entre os motoristas candidatos) — mesmo helper
    // cacheado (600s) usado em pricingEngine. Doc completo em vez de projeção
    // {isActive, allowedServices}: dataset pequeno, e um cache único por nome serve
    // todo mundo que precisa dessa categoria, não só esta função.
    const category = await getCachedVehicleCategoryByName(vehicleType);
    if (!category) return true; // legado: bancos antigos sem catálogo completo continuam operando até o seed/admin normalizar.
    if (category.isActive !== true) return false;
    return category.allowedServices?.[field] !== false;
}

async function filterCaptainsByServicePermission(captains, vehicleType, serviceKind, { TRACE_ID = '[AUDIT]' } = {}) {
    if (await isVehicleCategoryAllowed(vehicleType, serviceKind)) return captains;
    captains.forEach((captain) => {
        console.log(`[AUDIT][${TRACE_ID}] Captain ${captain._id} reprovado (categoria solicitada ${vehicleType} sem permissão para ${serviceKind})`);
    });
    return [];
}

async function findCaptainsNearPickup(pickup, vehicleType, {
    TRACE_ID = '[AUDIT]',
    excludeCaptainId,
    excludeActiveRide = false,
    excludeActiveParcel = false,
    serviceKind = 'ride',
    pickupCoordinates,
} = {}) {
    const suppliedLat = Number(pickupCoordinates?.lat);
    const suppliedLng = Number(pickupCoordinates?.lng);
    const hasSuppliedCoordinates = pickupCoordinates?.lat !== '' && pickupCoordinates?.lat != null
        && pickupCoordinates?.lng !== '' && pickupCoordinates?.lng != null
        && Number.isFinite(suppliedLat) && suppliedLat >= -90 && suppliedLat <= 90
        && Number.isFinite(suppliedLng) && suppliedLng >= -180 && suppliedLng <= 180;
    const resolvedPickupCoordinates = hasSuppliedCoordinates
        ? { ltd: suppliedLat, lng: suppliedLng }
        : await mapService.getAddressCoordinate(pickup);
    const captainsInRadius = await mapService.getCaptainsInTheRadius(
        resolvedPickupCoordinates.ltd,
        resolvedPickupCoordinates.lng,
        CAPTAIN_SEARCH_RADIUS_KM,
        TRACE_ID
    );

    const requestedCategory = await getCachedVehicleCategoryByName(vehicleType);
    let matching = filterCaptainsByVehicleType(captainsInRadius, vehicleType, {
        excludeCaptainId,
        TRACE_ID,
        category: requestedCategory,
    });

    matching = await filterCaptainsByServicePermission(matching, vehicleType, serviceKind, { TRACE_ID });

    matching = await filterCaptainsWithoutActiveWork(matching, {
        excludeActiveRide,
        excludeActiveParcel,
    });

    return {
        pickupCoordinates: { lat: resolvedPickupCoordinates.ltd, lng: resolvedPickupCoordinates.lng },
        captains: matching,
    };
}

module.exports = {
    CAPTAIN_SEARCH_RADIUS_KM,
    ACTIVE_RIDE_STATUSES,
    ACTIVE_PARCEL_STATUSES,
    filterCaptainsByVehicleType,
    filterCaptainsWithoutActiveWork,
    isVehicleCategoryAllowed,
    filterCaptainsByServicePermission,
    isCaptainAuthorizedForVehicleType,
    captainHasActiveRide,
    captainHasActiveParcel,
    acquireCaptainBusyLock,
    releaseCaptainBusyLock,
    releaseCaptainBusyLockIfIdle,
    findCaptainsNearPickup,
};
