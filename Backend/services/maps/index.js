const contract = require('./contract');
const { haversineKm } = require('./geo.util');

const MAPS_PROVIDER = process.env.MAPS_PROVIDER || 'osm';

function loadProvider() {
    if (MAPS_PROVIDER === 'osm') {
        return require('./osm.provider');
    }
    if (MAPS_PROVIDER === 'google') {
        return require('./google.provider');
    }
    throw new Error(`MAPS_PROVIDER desconhecido: "${MAPS_PROVIDER}". Valores válidos: "osm", "google".`);
}

const provider = loadProvider();

// haversineKm é matemática pura, não depende do provider selecionado
module.exports.haversineKm = haversineKm;

module.exports.getAddressCoordinate = async (address) => {
    const result = await provider.getAddressCoordinate(address);
    contract.checkCoordinate(result, `getAddressCoordinate:${MAPS_PROVIDER}`);
    return result;
};

module.exports.getDistanceTime = async (origin, destination) => {
    const result = await provider.getDistanceTime(origin, destination);
    contract.checkDistanceTime(result, `getDistanceTime:${MAPS_PROVIDER}`);
    return result;
};

// API pública ORIGINAL — mantida byte-a-byte igual (array simples), verificada na
// Etapa 2. Necessária porque o controller/frontend atuais esperam um array puro em
// /maps/get-suggestions. NÃO usar para o fluxo novo do Google (ver função abaixo).
module.exports.getAutoCompleteSuggestions = async (input, lat, lng) => {
    const result = await provider.getAutoCompleteSuggestions(input, lat, lng);
    const suggestions = Array.isArray(result) ? result : result.suggestions;
    contract.checkSuggestions(suggestions, `getAutoCompleteSuggestions:${MAPS_PROVIDER}`);
    return suggestions;
};

// Variante com sessionToken (Places New). Só o provider "google" usa sessão de
// verdade; "osm" normaliza para sessionToken=null. A ausência de lat/lng aqui é
// esperada e correta para o Google (por isso não roda o contract.checkSuggestions
// de lat/lng, que geraria aviso falso) — a resolução de coordenadas acontece em
// getPlaceDetails, só quando o usuário seleciona uma sugestão.
module.exports.getAutoCompleteSuggestionsWithSession = async (input, lat, lng, sessionToken) => {
    const result = await provider.getAutoCompleteSuggestions(input, lat, lng, sessionToken);
    if (Array.isArray(result)) {
        return { suggestions: result, sessionToken: null };
    }
    return result;
};

module.exports.getPlaceDetails = async (placeId, sessionToken) => {
    if (typeof provider.getPlaceDetails !== 'function') {
        throw new Error(`Provider "${MAPS_PROVIDER}" não implementa getPlaceDetails.`);
    }
    const result = await provider.getPlaceDetails(placeId, sessionToken);
    contract.checkCoordinate(result, `getPlaceDetails:${MAPS_PROVIDER}`);
    return result;
};

module.exports.getReverseGeocode = async (lat, lng) => {
    if (typeof provider.getReverseGeocode !== 'function') {
        throw new Error(`Provider "${MAPS_PROVIDER}" não implementa getReverseGeocode.`);
    }
    return provider.getReverseGeocode(lat, lng);
};
