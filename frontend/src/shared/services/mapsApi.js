import api from '@/shared/services/axios';

// Cliente HTTP para /maps/*. Criado para centralizar chamadas que antes ficavam
// espalhadas com axios cru + headers manuais (ex: Home.jsx chamando photon.komoot.io
// direto do browser, fora do backend e fora do cache).
export async function reverseGeocode(lat, lng) {
    const response = await api.get('/maps/reverse-geocode', { params: { lat, lng } });
    return response.data; // { address: string }
}

// Resolve coordenadas de um placeId (Places New — provider google). sessionToken é
// opcional, mas mantê-lo igual ao usado no autocomplete que originou o placeId reduz
// o custo (cobrança de sessão combinada em vez de chamada avulsa).
export async function getPlaceDetails(placeId, sessionToken) {
    const response = await api.get('/maps/place-details', { params: { placeId, sessionToken } });
    return response.data; // { ltd: number, lng: number, address: string }
}

/**
 * Autocomplete de endereço via backend (Google Places New ou OSM conforme MAPS_PROVIDER).
 * @returns {{ suggestions: Array, sessionToken: string|null }}
 */
export async function getAddressSuggestions({ input, lat, lng, sessionToken } = {}) {
    const params = { input };
    if (lat != null && lng != null) {
        params.lat = lat;
        params.lng = lng;
    }
    if (sessionToken) params.sessionToken = sessionToken;

    const response = await api.get('/maps/get-suggestions', { params });
    const suggestions = Array.isArray(response.data) ? response.data : [];
    const nextSession = response.headers?.['x-maps-session-token'] || sessionToken || null;
    return { suggestions, sessionToken: nextSession };
}

/** Formato usado pela Home ao criar corrida: "endereço (lat, lng)". */
export function formatAddressWithCoords({ address, lat, lng }) {
    const label = String(address || '').trim();
    if (!label) return '';
    if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
        return label;
    }
    return `${label} (${Number(lat)}, ${Number(lng)})`;
}

export function suggestionTitle(item) {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    return item.title
        || item.description
        || item.place_name
        || item.formatted
        || item.address
        || '';
}

export function suggestionSubtitle(item) {
    if (!item || typeof item === 'string') return '';
    return item.subtitle || item.secondary_text || '';
}
