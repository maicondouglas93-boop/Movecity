const axios = require('axios');
const crypto = require('crypto');
const { getCache, setCache } = require('../../cache/cache');
const { haversineKm, approximateRouteFromCoords } = require('./geo.util');
const { trackUsageSafe } = require('../monitoring/usageTracker');

const apiKey = () => process.env.GOOGLE_MAPS_API;

function trackMaps(sku, started, err = null) {
    const latencyMs = Date.now() - started;
    const statusCode = err?.response?.status || null;
    trackUsageSafe({
        service: 'google_maps',
        sku,
        latencyMs,
        ok: !err,
        statusCode,
    });
}

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
    const started = Date.now();
    try {
        const response = await axios.get(url, { timeout: 3000 });
        if (response.data.status === 'OK') {
            trackMaps('geocoding', started);
            const location = response.data.results[0].geometry.location;
            const result = { ltd: location.lat, lng: location.lng };
            setCache(cacheKey, result, 86400); // 24h
            return result;
        }
        const err = new Error(`Geocoding retornou status "${response.data.status}"`);
        trackMaps('geocoding', started, { response: { status: response.data.status === 'OVER_QUERY_LIMIT' ? 429 : 400 } });
        throw err;
    } catch (error) {
        if (!error._tracked) trackMaps('geocoding', started, error);
        console.warn('[google.provider] Geocoding falhou.', error.message);
        // Auditoria APK↔tarifas (2026-08-06): não inventar lat/lng — precificar
        // sobre ponto fictício gerava corrida com rota/preço errados.
        throw new Error('Unable to fetch coordinates');
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
    const started = Date.now();
    try {
        const response = await axios.get(url, { timeout: 3000 });
        if (response.data.status === 'OK' && response.data.results.length > 0) {
            trackMaps('reverse_geocoding', started);
            const result = { address: response.data.results[0].formatted_address };
            setCache(cacheKey, result, 3600); // 1h — posição pode repetir em raio pequeno
            return result;
        }
        trackMaps('reverse_geocoding', started, { response: { status: 400 } });
        throw new Error(`Reverse geocoding retornou status "${response.data.status}"`);
    } catch (error) {
        if (!error.response && error.message?.includes('retornou')) {
            /* já tracked */
        } else {
            trackMaps('reverse_geocoding', started, error);
        }
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
// Auditoria de cache (2026-08-08, A1): mesma chave/TTL que o branch Google já
// usado em osm.provider.js pra essa mesma função (google-autocomplete:<input>_<lat>_<lng>,
// 600s sucesso / 60s fallback) — só cacheia a lista de `suggestions`, nunca o
// `sessionToken`. sessionToken é gerado sempre fresco (com ou sem HIT) porque ele
// é o identificador de correlação de UMA sessão de busca pra fins de cobrança
// combinada do Google (autocomplete + place details); devolver um token
// reaproveitado de outra busca em cache não muda o resultado pro usuário, mas
// evita qualquer ambiguidade de sessão do lado do Google.
module.exports.getAutoCompleteSuggestions = async (input, lat, lng, sessionToken) => {
    const token = sessionToken || crypto.randomUUID();
    const cacheKey = `google-autocomplete:${input}_${lat || 'none'}_${lng || 'none'}`;
    const cached = getCache(cacheKey);
    if (cached) return { suggestions: cached, sessionToken: token };

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
        const started = Date.now();
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
        trackMaps('places_autocomplete', started);

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

        setCache(cacheKey, suggestions, 600); // 10min — mesmo TTL do branch Google em osm.provider.js
        return { suggestions, sessionToken: token };
    } catch (err) {
        trackMaps('places_autocomplete', Date.now(), err);
        console.warn('[google.provider] Places Autocomplete falhou. Retornando lista vazia.', err.response?.data?.error?.message || err.message);
        // TTL curto de propósito (60s, mesmo valor do fallback em osm.provider.js):
        // não trava uma lista vazia por 10min só porque a API oscilou por um instante.
        setCache(cacheKey, [], 60);
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
        const started = Date.now();
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
        trackMaps('place_details', started);

        const result = {
            ltd: response.data.location?.latitude,
            lng: response.data.location?.longitude,
            address: response.data.formattedAddress || response.data.displayName?.text || ''
        };
        setCache(cacheKey, result, 86400); // 24h — place_id é estável
        return result;
    } catch (err) {
        trackMaps('place_details', Date.now(), err);
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
        const started = Date.now();
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
        trackMaps('routes', started);

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
        trackMaps('routes', Date.now(), err);
        console.warn('[google.provider] Routes API falhou; usando aproximação haversine.', err.response?.data?.error?.message || err.message);
        const result = approximateRouteFromCoords(originCoords, destCoords);
        setCache(cacheKey, result, 300);
        return result;
    }
};

// Fase D da experiência de corrida ativa (2026-08-03): rota COM manobras.
// getDistanceTime acima devolve só distância/duração/polyline (é o que a precificação
// precisa). A navegação precisa de mais: a lista de conversões, cada uma com o ponto
// onde acontece — é o que alimenta o banner "em 200 m, vire à direita na Rua X".
// Vocabulário do Google normalizado para o conjunto pequeno e estável que o frontend
// conhece (ver navigationMath.maneuverIcon), pra que trocar de provider não mude a UI.
const GOOGLE_MANEUVER_MAP = {
    TURN_LEFT: 'turn-left',
    TURN_RIGHT: 'turn-right',
    TURN_SLIGHT_LEFT: 'turn-slight-left',
    TURN_SLIGHT_RIGHT: 'turn-slight-right',
    TURN_SHARP_LEFT: 'turn-sharp-left',
    TURN_SHARP_RIGHT: 'turn-sharp-right',
    UTURN_LEFT: 'uturn',
    UTURN_RIGHT: 'uturn',
    ROUNDABOUT_LEFT: 'roundabout',
    ROUNDABOUT_RIGHT: 'roundabout',
    MERGE: 'merge',
    FORK_LEFT: 'fork-left',
    FORK_RIGHT: 'fork-right',
    RAMP_LEFT: 'fork-left',
    RAMP_RIGHT: 'fork-right',
    STRAIGHT: 'straight',
    DEPART: 'straight',
    NAME_CHANGE: 'straight',
    DESTINATION: 'destination',
    DESTINATION_LEFT: 'destination',
    DESTINATION_RIGHT: 'destination',
};

module.exports.getRouteWithSteps = async (origin, destination) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const originCoords = await module.exports.getAddressCoordinate(origin);
    const destCoords = await module.exports.getAddressCoordinate(destination);

    const started = Date.now();
    let response;
    try {
        response = await axios.post(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
            origin: { location: { latLng: { latitude: originCoords.ltd, longitude: originCoords.lng } } },
            destination: { location: { latLng: { latitude: destCoords.ltd, longitude: destCoords.lng } } },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
            polylineEncoding: 'GEO_JSON_LINESTRING',
            languageCode: 'pt-BR',
            units: 'METRIC',
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey(),
                'X-Goog-FieldMask': [
                    'routes.duration',
                    'routes.distanceMeters',
                    'routes.polyline.geoJsonLinestring',
                    'routes.legs.steps.navigationInstruction',
                    'routes.legs.steps.distanceMeters',
                    'routes.legs.steps.startLocation',
                ].join(','),
            },
            timeout: 8000,
        }
        );
        trackMaps('routes', started);
    } catch (err) {
        trackMaps('routes', started, err);
        throw err;
    }

    const route = response.data.routes?.[0];
    if (!route) throw new Error('Invalid Routes API response');

    const durationSeconds = parseInt(route.duration, 10) || 0;
    const distanceMeters = route.distanceMeters || 0;
    const polyline = (route.polyline?.geoJsonLinestring?.coordinates || []).map(c => [c[1], c[0]]);

    // A instrução de um step descreve a manobra no INÍCIO dele (startLocation), não no
    // fim — usar endLocation deslocaria todo o guia uma conversão à frente.
    const steps = (route.legs || []).flatMap(leg => leg.steps || []).map(step => ({
        instruction: step.navigationInstruction?.instructions || '',
        maneuver: GOOGLE_MANEUVER_MAP[step.navigationInstruction?.maneuver] || 'straight',
        distanceMeters: step.distanceMeters || 0,
        location: {
            lat: step.startLocation?.latLng?.latitude,
            lng: step.startLocation?.latLng?.longitude,
        },
    })).filter(s => Number.isFinite(s.location.lat) && Number.isFinite(s.location.lng));

    return {
        distance: { text: `${(distanceMeters / 1000).toFixed(1)} km`, value: distanceMeters },
        duration: { text: `${Math.round(durationSeconds / 60)} mins`, value: durationSeconds },
        polyline,
        steps,
    };
};

module.exports.haversineKm = haversineKm;
