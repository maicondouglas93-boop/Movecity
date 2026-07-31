// Contrato normalizado que qualquer provider de mapas (osm, google, ...) deve respeitar.
// As validações aqui são apenas defensivas (log de aviso) e NUNCA lançam erro nem alteram
// o valor retornado — preservar o comportamento atual dos providers é intencional.
// Isso existe para detectar cedo os dois problemas já confirmados na auditoria:
//   - autocomplete sem lat/lng (achado §2.1)
//   - inversão de latitude/longitude entre providers (risco R6)

function isValidLat(v) {
    return typeof v === 'number' && !Number.isNaN(v) && v >= -90 && v <= 90;
}

function isValidLng(v) {
    return typeof v === 'number' && !Number.isNaN(v) && v >= -180 && v <= 180;
}

// { ltd, lng }
function checkCoordinate(coord, context = '') {
    if (!coord || !isValidLat(coord.ltd) || !isValidLng(coord.lng)) {
        console.warn(`[maps/contract] Coordenada fora do formato esperado ${context ? `(${context})` : ''}:`, coord);
        return false;
    }
    return true;
}

// { distance: {text, value}, duration: {text, value}, polyline? }
function checkDistanceTime(result, context = '') {
    const ok = result
        && typeof result.distance?.value === 'number'
        && typeof result.duration?.value === 'number';
    if (!ok) {
        console.warn(`[maps/contract] Resposta de distance/time fora do formato esperado ${context ? `(${context})` : ''}:`, result);
    }
    return ok;
}

// Array<{ text, title, subtitle, lat?, lng? }>
function checkSuggestions(list, context = '') {
    if (!Array.isArray(list)) {
        console.warn(`[maps/contract] Sugestões não são um array ${context ? `(${context})` : ''}:`, list);
        return false;
    }
    const missingCoords = list.filter(s => s.lat === undefined || s.lng === undefined);
    if (missingCoords.length > 0) {
        console.warn(`[maps/contract] ${missingCoords.length}/${list.length} sugestões sem lat/lng ${context ? `(${context})` : ''} — ver achado §2.1 do diagnóstico`);
    }
    return true;
}

module.exports = { isValidLat, isValidLng, checkCoordinate, checkDistanceTime, checkSuggestions };
