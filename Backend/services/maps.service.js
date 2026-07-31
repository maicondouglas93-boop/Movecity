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
module.exports.getCaptainsInTheRadius = async (ltd, lng, radius, traceId = '[AUDIT]') => {
    // radius in km
    const cacheKey = `drivers:${ltd}:${lng}:${radius * 1000}m`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    // Converte o raio de KM para Radianos (dividindo pelo raio da Terra, 6378.1 km)
    const radiusInRadians = radius / 6378.1;

    console.log(`${traceId} Buscando motoristas num raio de ${radius}km`);

    // Busca os motoristas
    // Exibindo todos na base por diagnóstico
    const allCaptains = await captainModel.find({});
    console.log(`${traceId} Total de capitães na base: ${allCaptains.length}`);
    for(let c of allCaptains) {
        if(!c.socketId) console.log(`${traceId} Captain ${c._id} reprovado (Offline / Sem socketId)`);
        else if(!c.canReceiveRides) console.log(`${traceId} Captain ${c._id} reprovado (canReceiveRides = false, saldo ou block)`);
        else console.log(`${traceId} Captain ${c._id} pré-aprovado na query de DB`);
    }

    const captains = await captainModel.find({
        socketId: { $exists: true, $ne: null, $ne: "" },
        canReceiveRides: { $ne: false } // Para pegar true ou undefined (documentos antigos)
    }).limit(20);

    console.log(`${traceId} Resultado do find real: ${captains.length} motoristas encontrados.`);

    setCache(cacheKey, captains, 10);
    return captains;
}
