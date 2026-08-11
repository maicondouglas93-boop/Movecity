import api from './api';

export async function getPlaceDetails(placeId, sessionToken) {
  const response = await api.get('/admin/maps/place-details', {
    params: { placeId, sessionToken },
  });
  return response.data;
}

export async function getAddressSuggestions({ input, lat, lng, sessionToken, signal } = {}) {
  const params = { input };
  if (lat != null && lng != null) {
    params.lat = lat;
    params.lng = lng;
  }
  if (sessionToken) params.sessionToken = sessionToken;

  const response = await api.get('/admin/maps/suggestions', { params, signal });
  const suggestions = Array.isArray(response.data) ? response.data : [];
  const nextSession = response.headers?.['x-maps-session-token'] || sessionToken || null;
  return { suggestions, sessionToken: nextSession };
}

export async function estimateRoute(pickup, destination) {
  const { data } = await api.post('/admin/tariffs/estimate-route', { pickup, destination });
  return data;
}

export function formatAddressWithCoords({ address, lat, lng }) {
  const label = String(address || '').trim();
  if (!label) return '';
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return label;
  }
  return `${label} (${Number(lat)}, ${Number(lng)})`;
}

export function parseAddressCoords(str) {
  const m = String(str || '').match(/\((-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
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
