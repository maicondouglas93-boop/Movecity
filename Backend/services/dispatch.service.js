const mapService = require('./maps.service');
const rideModel = require('../models/ride.model');
const { getCachedVehicleCategoryByName } = require('./vehicleCategoryCache.service');

const CAPTAIN_SEARCH_RADIUS_KM = 15;

const ACTIVE_RIDE_STATUSES = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started'];
const ACTIVE_PARCEL_STATUSES = [
    'provider_accepted',
    'going_to_pickup',
    'arrived_pickup',
    'collected',
    'in_transit',
    'arrived_destination',
];

/** Match estrito de categoria — sem fallback. */
function filterCaptainsByVehicleType(captains, vehicleType, { excludeCaptainId, TRACE_ID = '[AUDIT]' } = {}) {
    return captains.filter((captain) => {
        if (excludeCaptainId && captain._id.toString() === excludeCaptainId.toString()) {
            return false;
        }
        if (!captain.vehicle || !captain.vehicle.vehicleType) {
            console.log(`[AUDIT][${TRACE_ID}] Captain ${captain._id} reprovado (Sem veículo definido)`);
            return false;
        }
        const capType = captain.vehicle.vehicleType;
        const isMatch = capType === vehicleType;
        if (!isMatch) {
            console.log(`[AUDIT][${TRACE_ID}] Captain ${captain._id} reprovado (Veículo incompatível: ${capType} != ${vehicleType})`);
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

async function filterCaptainsByServicePermission(captains, serviceKind, { TRACE_ID = '[AUDIT]' } = {}) {
    const cache = new Map();
    const out = [];
    for (const captain of captains) {
        const vehicleType = captain.vehicle?.vehicleType;
        if (!cache.has(vehicleType)) cache.set(vehicleType, await isVehicleCategoryAllowed(vehicleType, serviceKind));
        if (cache.get(vehicleType)) out.push(captain);
        else console.log(`[AUDIT][${TRACE_ID}] Captain ${captain._id} reprovado (categoria ${vehicleType} sem permissão para ${serviceKind})`);
    }
    return out;
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

    let matching = filterCaptainsByVehicleType(captainsInRadius, vehicleType, {
        excludeCaptainId,
        TRACE_ID,
    });

    matching = await filterCaptainsByServicePermission(matching, serviceKind, { TRACE_ID });

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
    captainHasActiveRide,
    captainHasActiveParcel,
    acquireCaptainBusyLock,
    releaseCaptainBusyLock,
    releaseCaptainBusyLockIfIdle,
    findCaptainsNearPickup,
};
