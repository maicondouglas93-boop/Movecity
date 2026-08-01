const captainModel = require('../models/captain.model');
const { getCache, setCache } = require('../cache/cache');
const mapsProvider = require('./maps/index');

module.exports.haversineKm = mapsProvider.haversineKm;
module.exports.getAddressCoordinate = mapsProvider.getAddressCoordinate;
module.exports.getDistanceTime = mapsProvider.getDistanceTime;
module.exports.getAutoCompleteSuggestions = mapsProvider.getAutoCompleteSuggestions;
module.exports.getAutoCompleteSuggestionsWithSession = mapsProvider.getAutoCompleteSuggestionsWithSession;
module.exports.getPlaceDetails = mapsProvider.getPlaceDetails;
module.exports.getReverseGeocode = mapsProvider.getReverseGeocode;

// Não depende de nenhum provider de mapas (OSM/Google) — é uma consulta direta ao Mongo.
module.exports.getCaptainsInTheRadius = async (ltd, lng, radiusKm, traceId = '[AUDIT]') => {
    const cacheKey = `drivers:${ltd}:${lng}:${radiusKm}km`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    // Filtro geográfico real via 2dsphere ($nearSphere), já ordenado por proximidade.
    // Antes esta função ignorava ltd/lng/radius e retornava até 20 motoristas online
    // de qualquer lugar do mundo.
    const captains = await captainModel.find({
        locationGeoJSON: {
            $nearSphere: {
                $geometry: { type: 'Point', coordinates: [ lng, ltd ] },
                $maxDistance: radiusKm * 1000 // metros
            }
        },
        socketId: { $exists: true, $ne: null, $ne: "" },
        isOnline: true,
        canReceiveRides: { $ne: false }, // Para pegar true ou undefined (documentos antigos)
        isBlocked: { $ne: true },
        approvalStatus: 'aprovado'
    }).limit(20);

    console.log(`${traceId} ${captains.length} motoristas encontrados num raio de ${radiusKm}km`);

    setCache(cacheKey, captains, 10);
    return captains;
}
