const axios = require('axios');
const { getCache, setCache } = require('../../cache/cache');
const { haversineKm } = require('./geo.util');

// Geocoding reverso via Nominatim — não existia no código original (Home.jsx chama
// Photon direto do browser). Adicionado para simetria com google.provider.js, sem
// alterar nenhum comportamento existente (é uma função nova, não uma mudança).
module.exports.getReverseGeocode = async (lat, lng) => {
    const cacheKey = `reverse:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
        const response = await axios.get(url, {
            timeout: 3000,
            headers: { 'User-Agent': 'UberCloneApp' }
        });
        if (response.data && response.data.display_name) {
            const result = { address: response.data.display_name };
            setCache(cacheKey, result, 3600); // 1h
            return result;
        }
        throw new Error('Nominatim reverse geocoding sem resultado');
    } catch (err) {
        console.warn('[osm.provider] Reverse geocoding falhou.', err.message);
        return { address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    }
};

module.exports.getAddressCoordinate = async (address) => {
    // Extract exact coordinates if the string contains them like "Address (-20.12, -41.22)" or just "-20.12, -41.22"
    const coordMatch = address.match(/\((-?\d+\.\d+),\s*(-?\d+\.\d+)\)$/) || address.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);
    if (coordMatch) {
        return {
            ltd: parseFloat(coordMatch[1]),
            lng: parseFloat(coordMatch[2])
        };
    }

    const apiKey = process.env.GOOGLE_MAPS_API;
    const isGoogle = apiKey && apiKey !== 'dummy-google-maps-api-key';
    const cacheKey = isGoogle ? `google-geocode:${address}` : `geocode:${address}`;

    const cached = getCache(cacheKey);
    if (cached) return cached;

    if (!isGoogle) {
        console.log("No Google Maps API Key found. Fetching from Nominatim (OSM).");
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
            const response = await axios.get(url, {
                timeout: 3000,
                headers: { 'User-Agent': 'UberCloneApp' }
            });
            if (response.data && response.data.length > 0) {
                const feature = response.data[0];
                const result = { ltd: parseFloat(feature.lat), lng: parseFloat(feature.lon) };
                setCache(cacheKey, result, 3600); // 1 hora
                return result;
            }
        } catch (err) {
            console.warn("Nominatim geocoding failed. Using mock coordinates.", err.message);
        }
        return {
            ltd: -20.15 + (address.length % 10) * 0.01,
            lng: -41.62 + (address.length % 7) * 0.01
        };
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;

    try {
        const response = await axios.get(url, { timeout: 3000 });
        if (response.data.status === 'OK') {
            const location = response.data.results[ 0 ].geometry.location;
            const result = { ltd: location.lat, lng: location.lng };
            setCache(cacheKey, result, 86400); // 24 hours
            return result;
        } else {
            throw new Error('Unable to fetch coordinates');
        }
    } catch (error) {
        console.warn("Geocoding failed. Returning mock coordinates.", error.message);
        // Fallback for demo: São Paulo (Brazil) instead of Mumbai
        return {
            ltd: -23.5505 + (address.length % 10) * 0.001,
            lng: -46.6333 + (address.length % 7) * 0.001
        };
    }
}

module.exports.getDistanceTime = async (origin, destination) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const cacheKey = `route:${origin}:${destination}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    let originCoords, destCoords;
    try {
        originCoords = await module.exports.getAddressCoordinate(origin);
        destCoords = await module.exports.getAddressCoordinate(destination);
    } catch (e) {
        throw new Error('Unable to resolve coordinates for origin or destination');
    }

    const primaryEngine = process.env.PRIMARY_ROUTING_ENGINE || 'graphhopper';
    const ghKey = process.env.GRAPHHOPPER_API_KEY;
    const hasGhKey = ghKey && ghKey !== 'dummy-graphhopper-api-key';

    const getGraphHopperRoute = async () => {
        if (!hasGhKey) throw new Error("No GraphHopper Key");
        console.log("Fetching route from GraphHopper...");
        const url = `https://graphhopper.com/api/1/route?point=${originCoords.ltd},${originCoords.lng}&point=${destCoords.ltd},${destCoords.lng}&profile=car&locale=pt-BR&calc_points=true&points_encoded=false&key=${ghKey}`;
        const response = await axios.get(url, { timeout: 4000 });
        if (response.data && response.data.paths && response.data.paths.length > 0) {
            const route = response.data.paths[0];
            return {
                distance: { text: `${(route.distance / 1000).toFixed(1)} km`, value: Math.round(route.distance) },
                duration: { text: `${Math.round(route.time / 60000)} mins`, value: Math.round(route.time / 1000) },
                polyline: route.points.coordinates.map(coord => [coord[1], coord[0]])
            };
        }
        throw new Error("Invalid GraphHopper response");
    };

    const getOSRMRoute = async () => {
        console.log("Fetching route from OSRM...");
        const url = `https://router.project-osrm.org/route/v1/driving/${originCoords.lng},${originCoords.ltd};${destCoords.lng},${destCoords.ltd}?overview=full&geometries=geojson`;
        const response = await axios.get(url, { timeout: 3000 });
        if (response.data && response.data.routes && response.data.routes.length > 0) {
            const route = response.data.routes[0];
            return {
                distance: { text: `${(route.distance / 1000).toFixed(1)} km`, value: Math.round(route.distance) },
                duration: { text: `${Math.round(route.duration / 60)} mins`, value: Math.round(route.duration) },
                polyline: route.geometry.coordinates.map(coord => [coord[1], coord[0]])
            };
        }
        throw new Error("Invalid OSRM response");
    };

    let result = null;

    if (primaryEngine === 'graphhopper') {
        try {
            result = await getGraphHopperRoute();
        } catch (err) {
            console.warn("GraphHopper failed, falling back to OSRM.", err.message);
            try { result = await getOSRMRoute(); } catch (e) { console.warn("OSRM fallback failed", e.message); }
        }
    } else {
        try {
            result = await getOSRMRoute();
        } catch (err) {
            console.warn("OSRM failed, falling back to GraphHopper.", err.message);
            try { result = await getGraphHopperRoute(); } catch (e) { console.warn("GraphHopper fallback failed", e.message); }
        }
    }

    if (result) {
        setCache(cacheKey, result, 86400); // 24 hours
        return result;
    }

    // Final mock fallback
    return {
        distance: { text: "15.2 km", value: 15200 },
        duration: { text: "32 mins", value: 1920 },
        polyline: [[originCoords.ltd, originCoords.lng], [destCoords.ltd, destCoords.lng]]
    };
}

// Fase D da experiência de corrida ativa (2026-08-03): rota COM manobras.
// GraphHopper é o caminho preferido aqui porque devolve as instruções já em pt-BR
// (`locale=pt-BR`); o OSRM público não devolve texto de instrução nenhum — só o tipo
// de manobra e o nome da via —, então a frase é montada aqui.
const GH_SIGN_MAP = {
    '-98': 'uturn',
    '-8': 'uturn',
    '-7': 'straight',   // manter-se à esquerda
    '-3': 'turn-sharp-left',
    '-2': 'turn-left',
    '-1': 'turn-slight-left',
    '0': 'straight',
    '1': 'turn-slight-right',
    '2': 'turn-right',
    '3': 'turn-sharp-right',
    '4': 'destination',
    '5': 'straight',    // via alcançada
    '6': 'roundabout',
    '7': 'straight',    // manter-se à direita
};

const OSRM_MODIFIER_MAP = {
    'left': 'turn-left',
    'right': 'turn-right',
    'slight left': 'turn-slight-left',
    'slight right': 'turn-slight-right',
    'sharp left': 'turn-sharp-left',
    'sharp right': 'turn-sharp-right',
    'uturn': 'uturn',
    'straight': 'straight',
};

const OSRM_MANEUVER_TEXT = {
    'turn-left': 'Vire à esquerda',
    'turn-right': 'Vire à direita',
    'turn-slight-left': 'Mantenha-se à esquerda',
    'turn-slight-right': 'Mantenha-se à direita',
    'turn-sharp-left': 'Curva acentuada à esquerda',
    'turn-sharp-right': 'Curva acentuada à direita',
    'uturn': 'Faça o retorno',
    'roundabout': 'Entre na rotatória',
    'merge': 'Entre na via',
    'destination': 'Você chegou ao destino',
    'straight': 'Siga em frente',
};

module.exports.getRouteWithSteps = async (origin, destination) => {
    if (!origin || !destination) {
        throw new Error('Origin and destination are required');
    }

    const originCoords = await module.exports.getAddressCoordinate(origin);
    const destCoords = await module.exports.getAddressCoordinate(destination);

    const ghKey = process.env.GRAPHHOPPER_API_KEY;
    const hasGhKey = ghKey && ghKey !== 'dummy-graphhopper-api-key';

    if (hasGhKey) {
        try {
            const url = `https://graphhopper.com/api/1/route?point=${originCoords.ltd},${originCoords.lng}&point=${destCoords.ltd},${destCoords.lng}&profile=car&locale=pt-BR&calc_points=true&points_encoded=false&instructions=true&key=${ghKey}`;
            const response = await axios.get(url, { timeout: 5000 });
            const path = response.data?.paths?.[0];
            if (path) {
                const points = path.points.coordinates.map(c => [c[1], c[0]]);
                // `interval` é [primeiro, último] ponto do trecho, e o texto descreve o
                // que fazer no INÍCIO dele — por isso o ponto da manobra é interval[0].
                const steps = (path.instructions || []).map(inst => {
                    const idx = Array.isArray(inst.interval) ? inst.interval[0] : 0;
                    const point = points[idx];
                    return {
                        instruction: inst.text || '',
                        maneuver: GH_SIGN_MAP[String(inst.sign)] || 'straight',
                        distanceMeters: Math.round(inst.distance || 0),
                        location: point ? { lat: point[0], lng: point[1] } : null,
                    };
                }).filter(s => s.location);

                return {
                    distance: { text: `${(path.distance / 1000).toFixed(1)} km`, value: Math.round(path.distance) },
                    duration: { text: `${Math.round(path.time / 60000)} mins`, value: Math.round(path.time / 1000) },
                    polyline: points,
                    steps,
                };
            }
        } catch (err) {
            console.warn('[osm.provider] GraphHopper com instruções falhou, tentando OSRM.', err.message);
        }
    }

    const url = `https://router.project-osrm.org/route/v1/driving/${originCoords.lng},${originCoords.ltd};${destCoords.lng},${destCoords.ltd}?overview=full&geometries=geojson&steps=true`;
    const response = await axios.get(url, { timeout: 5000 });
    const route = response.data?.routes?.[0];
    if (!route) throw new Error('Invalid OSRM response');

    const steps = (route.legs || []).flatMap(leg => leg.steps || []).map(step => {
        const type = step.maneuver?.type;
        let maneuver = OSRM_MODIFIER_MAP[step.maneuver?.modifier] || 'straight';
        if (type === 'arrive') maneuver = 'destination';
        else if (type === 'roundabout' || type === 'rotary') maneuver = 'roundabout';
        else if (type === 'merge') maneuver = 'merge';

        const street = step.name ? ` em ${step.name}` : '';
        const base = OSRM_MANEUVER_TEXT[maneuver] || OSRM_MANEUVER_TEXT.straight;
        return {
            instruction: maneuver === 'destination' ? base : `${base}${street}`,
            maneuver,
            distanceMeters: Math.round(step.distance || 0),
            location: {
                lat: step.maneuver?.location?.[1],
                lng: step.maneuver?.location?.[0],
            },
        };
    }).filter(s => Number.isFinite(s.location.lat) && Number.isFinite(s.location.lng));

    return {
        distance: { text: `${(route.distance / 1000).toFixed(1)} km`, value: Math.round(route.distance) },
        duration: { text: `${Math.round(route.duration / 60)} mins`, value: Math.round(route.duration) },
        polyline: route.geometry.coordinates.map(c => [c[1], c[0]]),
        steps,
    };
}

module.exports.getAutoCompleteSuggestions = async (input, lat, lng) => {
    if (!input) {
        throw new Error('query is required');
    }

    const apiKey = process.env.GOOGLE_MAPS_API;
    const isGoogle = apiKey && apiKey !== 'dummy-google-maps-api-key';
    const cacheKey = isGoogle ? `google-autocomplete:${input}_${lat || 'none'}_${lng || 'none'}` : `autocomplete:${input}_${lat || 'none'}_${lng || 'none'}`;

    const cached = getCache(cacheKey);
    if (cached) return cached;

    const mockSuggestions = []; // Fallback seguro e neutro, em vez de "Mumbai"

    if (!isGoogle) {
        console.log("No Google Maps API Key found. Fetching suggestions from Photon (OSM).");
        try {
            let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&limit=15&addressdetails=1`;
            if (lat && lng) {
                const flat = parseFloat(lat);
                const flng = parseFloat(lng);
                if (!isNaN(flat) && !isNaN(flng)) {
                    const viewbox = `${flng - 0.5},${flat + 0.5},${flng + 0.5},${flat - 0.5}`;
                    url += `&viewbox=${viewbox}&bounded=0`;
                }
            }

            const response = await axios.get(url, {
                timeout: 6000,
                headers: { 'User-Agent': 'UberCloneApp' }
            });

            if (response.data && response.data.length > 0) {
                // Calculate distance and format string for each feature
                const results = response.data.map(f => {
                    const place = f.name || '';
                    const parts = f.display_name.split(',').map(s => s.trim());

                    let title = place;
                    if (!title && parts.length > 0) {
                        title = parts[0];
                    }

                    let subtitle = parts.length > 1 ? parts.slice(1).join(', ') : '';

                    let finalStr = title;
                    if (subtitle) finalStr += ` - ${subtitle}`;
                    if (!finalStr) finalStr = f.display_name;

                    let distance = Infinity;
                    let flat = parseFloat(f.lat);
                    let flng = parseFloat(f.lon);

                    if (!isNaN(flat) && !isNaN(flng)) {
                        finalStr += ` (${flat.toFixed(4)}, ${flng.toFixed(4)})`;
                        if (lat && lng) {
                            distance = haversineKm(lat, lng, flat, flng);
                        }
                    }

                    return {
                        text: finalStr,
                        title: title || finalStr.split(',')[0],
                        subtitle: subtitle,
                        lat: flat,
                        lng: flng,
                        distance
                    };
                });

                // Sort by distance (if available)
                results.sort((a, b) => a.distance - b.distance);

                // Return top 5 formatted objects
                const finalSuggestions = results.slice(0, 5).map(r => {
                    delete r.distance; // Optional cleanup
                    return r;
                });

                setCache(cacheKey, finalSuggestions, 600); // 10 minutes
                return finalSuggestions;
            }
        } catch (err) {
            console.warn("Nominatim autocomplete failed. Using mock suggestions.", err.message);
        }
        setCache(cacheKey, mockSuggestions, 60); // 1 min fallback cache
        return mockSuggestions;
    }

    let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&key=${apiKey}`;
    if (lat && lng) {
        url += `&location=${lat},${lng}&radius=20000`;
    }

    try {
        const response = await axios.get(url, { timeout: 3000 });
        if (response.data.status === 'OK') {
            const suggestions = response.data.predictions.map(prediction => {
                const parts = prediction.description.split(',');
                const title = parts[0];
                const subtitle = parts.slice(1).join(',').trim();
                return {
                    text: prediction.description,
                    title: title,
                    subtitle: subtitle
                };
            }).filter(value => value.title);

            setCache(cacheKey, suggestions, 600);
            return suggestions;
        } else {
            throw new Error('Unable to fetch suggestions');
        }
    } catch (err) {
        console.warn("Autocomplete failed. Returning mock suggestions.", err.message);
        setCache(cacheKey, mockSuggestions, 60); // 1 min fallback cache
        return mockSuggestions;
    }
}
