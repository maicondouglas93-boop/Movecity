const axios = require('axios');
const captainModel = require('../models/captain.model');
const { getCache, setCache } = require('../cache/cache');

// Fórmula de Haversine para calcular distância entre duas coordenadas em km
function haversineKm(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
module.exports.haversineKm = haversineKm;

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