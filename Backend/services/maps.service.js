const captainModel = require('../models/captain.model');
const { getCache, setCache } = require('../cache/cache');
const mapsProvider = require('./maps/index');

module.exports.haversineKm = mapsProvider.haversineKm;
module.exports.getAddressCoordinate = mapsProvider.getAddressCoordinate;
module.exports.getDistanceTime = mapsProvider.getDistanceTime;
// Fase D da experiência de corrida ativa (2026-08-03): rota com manobras (navegação).
module.exports.getRouteWithSteps = mapsProvider.getRouteWithSteps;
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
    //
    // Separação disponibilidade x conexão (2026-08-03): a exigência de `socketId`
    // saiu daqui. Ela era o motivo de um motorista com o app fechado nunca ser
    // candidato ao despacho — e, por consequência, de a push de corrida nova (todo o
    // objetivo da correção do sistema de notificações) ser inalcançável na prática.
    // Quem define disponibilidade agora é captainService.availabilityFilter():
    // intenção explícita (`isOnline`) + contato recente (`lastSeenAt`, com TTL).
    const captainService = require('./captain.service');
    const captains = await captainModel.find({
        locationGeoJSON: {
            $nearSphere: {
                $geometry: { type: 'Point', coordinates: [ lng, ltd ] },
                $maxDistance: radiusKm * 1000 // metros
            }
        },
        ...captainService.availabilityFilter()
    }).limit(20);

    console.log(`${traceId} ${captains.length} motoristas encontrados num raio de ${radiusKm}km`);

    setCache(cacheKey, captains, 10);
    return captains;
}
