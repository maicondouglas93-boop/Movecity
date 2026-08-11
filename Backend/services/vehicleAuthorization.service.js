const { getCachedActiveVehicleCategories, getCachedVehicleCategoryByName } = require('./vehicleCategoryCache.service');

const VEHICLE_AUTHORIZATIONS = Object.freeze({
    CAR: 'car',
    MOTORCYCLE: 'motorcycle',
    CAR_MOTORCYCLE: 'car_motorcycle',
});

const VALID_VEHICLE_AUTHORIZATIONS = Object.freeze(Object.values(VEHICLE_AUTHORIZATIONS));

function normalizeVehicleAuthorization(value) {
    return VALID_VEHICLE_AUTHORIZATIONS.includes(value) ? value : null;
}

function vehicleFamilyFromCategory(categoryOrName) {
    const name = typeof categoryOrName === 'string'
        ? categoryOrName
        : categoryOrName?.name;
    const iconKey = typeof categoryOrName === 'object'
        ? categoryOrName?.iconKey
        : null;
    const candidates = [iconKey, name]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());

    if (candidates.some((value) => ['moto', 'motorcycle'].includes(value))) {
        return VEHICLE_AUTHORIZATIONS.MOTORCYCLE;
    }
    if (candidates.includes('car')) {
        return VEHICLE_AUTHORIZATIONS.CAR;
    }
    return null;
}

function deriveLegacyAuthorization(captain, category) {
    const explicit = normalizeVehicleAuthorization(captain?.vehicleAuthorization);
    if (explicit) return explicit;
    return vehicleFamilyFromCategory(category || captain?.vehicle?.vehicleType);
}

function authorizationAllowsFamily(authorization, family) {
    const normalized = normalizeVehicleAuthorization(authorization);
    if (!normalized || !family) return false;
    return normalized === VEHICLE_AUTHORIZATIONS.CAR_MOTORCYCLE || normalized === family;
}

async function isCaptainAuthorizedForVehicleType(captain, requestedVehicleType) {
    if (!captain || !requestedVehicleType) return false;
    const category = await getCachedVehicleCategoryByName(requestedVehicleType);
    const requestedFamily = vehicleFamilyFromCategory(category || requestedVehicleType);
    const authorization = deriveLegacyAuthorization(captain);

    if (requestedFamily && authorization) {
        return authorizationAllowsFamily(authorization, requestedFamily);
    }

    // Categoria antiga/desconhecida: conserva exatamente a regra anterior, sem liberar
    // um tipo de serviço que não pode ser inferido com segurança.
    return captain.vehicle?.vehicleType === requestedVehicleType;
}

async function getAuthorizedVehicleTypesForCaptain(captain, serviceKind) {
    if (!captain) return [];
    const fieldByKind = {
        ride: 'ride',
        parcel: 'parcel',
        scheduledRide: 'scheduledRide',
        scheduledParcel: 'scheduledParcel',
    };
    const serviceField = fieldByKind[serviceKind];
    if (!serviceField) return [];

    const categories = await getCachedActiveVehicleCategories();
    const authorization = deriveLegacyAuthorization(captain);
    const activeCategories = categories || [];
    const allowed = activeCategories
        .filter((category) => category.allowedServices?.[serviceField] !== false)
        .filter((category) => authorizationAllowsFamily(authorization, vehicleFamilyFromCategory(category)))
        .map((category) => category.name);

    if (allowed.length > 0) return [...new Set(allowed)];

    const currentType = captain.vehicle?.vehicleType;
    if (!currentType) return [];

    // O catálogo legado podia não conter a categoria atual. Preservamos esse match
    // estrito, mas nunca usamos o fallback para furar uma autorização conhecida nem
    // para reativar uma categoria/serviço que o ADM desabilitou.
    const currentCategory = activeCategories.find((category) => category.name === currentType)
        || await getCachedVehicleCategoryByName(currentType);
    if (currentCategory) {
        if (currentCategory.isActive !== true) return [];
        if (currentCategory.allowedServices?.[serviceField] === false) return [];
    }

    const currentFamily = vehicleFamilyFromCategory(currentCategory || currentType);
    if (currentFamily && !authorizationAllowsFamily(authorization, currentFamily)) return [];
    return [currentType];
}

module.exports = {
    VEHICLE_AUTHORIZATIONS,
    VALID_VEHICLE_AUTHORIZATIONS,
    normalizeVehicleAuthorization,
    vehicleFamilyFromCategory,
    deriveLegacyAuthorization,
    authorizationAllowsFamily,
    isCaptainAuthorizedForVehicleType,
    getAuthorizedVehicleTypesForCaptain,
};
