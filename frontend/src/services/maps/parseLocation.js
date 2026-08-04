// Extrai coordenadas de pickup/destination no formato que a Home grava ao criar a
// corrida: "endereço (lat, lng)". Sem isso o mapa re-geocodifica a string inteira.

const EMBEDDED_COORD_RE = /\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)$/;

export function sanitizeCoord(lat, lng) {
    if (lat === null || lat === undefined || lat === '' || isNaN(Number(lat))) return null;
    if (lng === null || lng === undefined || lng === '' || isNaN(Number(lng))) return null;
    const nLat = Number(lat);
    const nLng = Number(lng);
    if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) return null;
    return { lat: nLat, lng: nLng };
}

export function coordFromInput(input) {
    if (!input) return null;
    if (typeof input === 'object') {
        return sanitizeCoord(input.lat ?? input.ltd, input.lng);
    }
    if (typeof input === 'string') {
        const match = input.trim().match(EMBEDDED_COORD_RE);
        if (match) return sanitizeCoord(match[1], match[2]);
    }
    return null;
}

export function addressFromInput(input) {
    if (!input) return null;
    if (typeof input === 'object') return input.address || null;
    if (typeof input !== 'string') return null;
    return input.replace(EMBEDDED_COORD_RE, '').trim() || input;
}
