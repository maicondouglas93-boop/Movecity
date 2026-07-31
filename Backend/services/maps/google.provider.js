const axios = require('axios');
const crypto = require('crypto');
const { getCache, setCache } = require('../../cache/cache');
const { haversineKm } = require('./geo.util');

const apiKey = () => process.env.GOOGLE_MAPS_API;

// Mesma extração de coordenadas embutidas usada pelo osm.provider.js — o formato
// "Endereço (lat, lng)" é uma convenção do MoveCity, independente de provider.
function extractEmbeddedCoords(address) {
    const m = address.match(/\((-?\d+\.\d+),\s*(-?\d+\.\d+)\)$/) || address.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);
    if (!m) return null;
    return { ltd: parseFloat(m[1]), lng: parseFloat(m[2]) };
}

module.exports.getAddressCoordinate = async (address) => {
    const embedded = extractEmbeddedCoords(address);
    if (embedded) return embedded;

    const cacheKey = `google-geocode:${address}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey()}`;
    try {
        const response = await axios.get(url, { timeout: 3000 });
        if (response.data.status === 'OK') {
            const location = response.data.results[0].geometry.location;
            const result = { ltd: location.lat, lng: location.lng };
            setCache(cacheKey, result, 86400); // 24h
            return result;
        }
        throw new Error(`Geocoding retornou status "${response.data.status}"`);
    } catch (error) {
        console.warn('[google.provider] Geocoding falhou. Retornando coordenadas aproximadas.', error.message);
        return {
            ltd: -23.5505 + (address.length % 10) * 0.001,
            lng: -46.6333 + (address.length % 7) * 0.001
        };
    }
};

// Geocoding reverso: coordenadas -> endereço. Usado para substituir as chamadas
// diretas do frontend ao Photon (achado da auditoria — Home.jsx chama terceiros
// direto do browser, fora do backend e fora do cache).
module.exports.getReverseGeocode = async (lat, lng) => {
    const cacheKey = `google-reverse:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey()}`;
    try {
        const response = await axios.get(url, { timeout: 3000 });
        if (response.data.status === 'OK' && response.data.results.length > 0) {
            const result = { address: response.data.results[0].formatted_address };
            setCache(cacheKey, result, 3600); // 1h — posição pode repetir em raio pequeno
            return result;
        }
        throw new Error(`Reverse geocoding retornou status "${response.data.status}"`);
    } catch (error) {
        console.warn('[google.provider] Reverse geocoding falhou.', error.message);
        return { address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    }
};

// Places Autocomplete (New). NÃO retorna lat/lng — nenhuma versão da API de
// autocomplete retorna (é assim por design, tanto a legada quanto a New). Backfillar
// coordenadas aqui exigiria 1 chamada de Place Details por sugestão (até 5 por busca,
// a cada tecla digitada), o que não cabe no orçamento definido (D4, US$ 10/mês).
// O padrão correto e mais barato do Google é: autocomplete devolve `placeId` +
// `sessionToken`; getPlaceDetails() só é chamado quando o usuário efetivamente
// seleciona uma sugestão, fechando a sessão (cobrança combinada, mais barata).
module.exports.getAutoCompleteSuggestions = async (input, lat, lng, sessionToken) => {
    const token = sessionToken || crypto.randomUUID();

    const body = {
        input,
        sessionToken: token
    };
    if (lat && lng) {
        const flat = parseFloat(lat);
        const flng = parseFloat(lng);
        if (!isNaN(flat) && !isNaN(flng)) {
            body.locationBias = {
                circle: {
                    center: { latitude: flat, longitude: flng },
                    radius: 20000.0
                }
            };
        }
    }

    try {
        const response = await axios.post(
            'https://places.googleapis.com/v1/places:autocomplete',
            body,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey()
                },
                timeout: 4000
            }
        );

        const predictions = response.data.suggestions || [];
        const suggestions = predictions
            .map(s => s.placePrediction)
            .filter(Boolean)
            .map(p => ({
                text: p.text?.text || '',
                title: p.structuredFormat?.mainText?.text || p.text?.text || '',
                subtitle: p.structuredFormat?.secondaryText?.text || '',
                placeId: p.placeId
            }));

        return { suggestions, sessionToken: token };
    } catch (err) {
        console.warn('[google.provider] Places Autocomplete falhou. Retornando lista vazia.', err.response?.data?.error?.message || err.message);
        return { suggestions: [], sessionToken: token };
    }
};

// Place Details (New). Resolve lat/lng para o placeId escolhido pelo usuário,
// fechando a sessão iniciada em getAutoCompleteSuggestions (mesmo sessionToken).
module.exports.getPlaceDetails = async (placeId, sessionToken) => {
    if (!placeId) {
        throw new Error('placeId is required');
    }

    const cacheKey = `google-place-details:${placeId}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    try {
        const params = sessionToken ? { sessionToken } : {};
        const response = await axios.get(
            `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
            {
                params,
                headers: {
                    'X-Goog-Api-Key': apiKey(),
                    'X-Goog-FieldMask': 'location,formattedAddress,displayName'
                },
                timeout: 3000
            }
        );

        const result = {
            ltd: response.data.location?.latitude,
            lng: response.data.location?.longitude,
            address: response.data.formattedAddress || response.data.displayName?.text || ''
        };
        setCache(cacheKey, result, 86400); // 24h — place_id é estável
        return result;
    } catch (err) {
        console.error('[google.provider] Place Details falhou:', err.response?.data?.error?.message || err.message);
        throw new Error('Unable to fetch place details');
    }
};

// Routes API (Compute Routes). routingPreference TRAFFIC_AWARE conforme decisão D1
// do plano (aceito o novo patamar de preço médio de +5,3%, sem compensação na PricingEngine).
module.exports.getDistanceTime = async (origin, destination) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const cacheKey = `google-route:${origin}:${destination}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    let originCoords, destCoords;
    try {
        originCoords = await module.exports.getAddressCoordinate(origin);
        destCoords = await module.exports.getAddressCoordinate(destination);
    } catch (e) {
        throw new Error('Unable to resolve coordinates for origin or destination');
    }

    try {
        const response = await axios.post(
            'https://routes.googleapis.com/directions/v2:computeRoutes',
            {
                origin: { location: { latLng: { latitude: originCoords.ltd, longitude: originCoords.lng } } },
                destination: { location: { latLng: { latitude: destCoords.ltd, longitude: destCoords.lng } } },
                travelMode: 'DRIVE',
                routingPreference: 'TRAFFIC_AWARE',
                polylineEncoding: 'GEO_JSON_LINESTRING'
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey(),
                    'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.geoJsonLinestring'
                },
                timeout: 8000
            }
        );

        const route = response.data.routes?.[0];
        if (!route) throw new Error('Invalid Routes API response');

        const durationSeconds = parseInt(route.duration, 10) || 0;
        const distanceMeters = route.distanceMeters || 0;
        // GeoJSON vem como [lng, lat] — inverte para [lat, lng], mesma convenção usada
        // pelos branches GraphHopper/OSRM já existentes.
        const polyline = (route.polyline?.geoJsonLinestring?.coordinates || [])
            .map(coord => [coord[1], coord[0]]);

        const result = {
            distance: { text: `${(distanceMeters / 1000).toFixed(1)} km`, value: distanceMeters },
            duration: { text: `${Math.round(durationSeconds / 60)} mins`, value: durationSeconds },
            polyline
        };

        setCache(cacheKey, result, 86400); // 24h
        return result;
    } catch (err) {
        console.warn('[google.provider] Routes API falhou. Retornando fallback aproximado.', err.response?.data?.error?.message || err.message);
        return {
            distance: { text: '15.2 km', value: 15200 },
            duration: { text: '32 mins', value: 1920 },
            polyline: [[originCoords.ltd, originCoords.lng], [destCoords.ltd, destCoords.lng]]
        };
    }
};

module.exports.haversineKm = haversineKm;
