/**
 * Limites gratuitos / créditos de referência (atualizáveis via env).
 * Valores aproximados para estimativa — o painel deixa claro a fonte.
 */
const GOOGLE_MAPS_SKUS = {
    geocoding: {
        label: 'Geocoding API',
        // Crédito mensal Google Maps Platform ~US$200; custo ~US$5/1k
        freeMonthlyRequests: Number(process.env.GMAPS_FREE_GEOCODING || 40000),
        costPer1000Usd: 5,
    },
    reverse_geocoding: {
        label: 'Reverse Geocoding',
        freeMonthlyRequests: Number(process.env.GMAPS_FREE_REVERSE_GEOCODING || 40000),
        costPer1000Usd: 5,
    },
    places_autocomplete: {
        label: 'Places Autocomplete',
        freeMonthlyRequests: Number(process.env.GMAPS_FREE_PLACES_AUTOCOMPLETE || 70000),
        costPer1000Usd: 2.83,
    },
    place_details: {
        label: 'Places API (Details)',
        freeMonthlyRequests: Number(process.env.GMAPS_FREE_PLACE_DETAILS || 40000),
        costPer1000Usd: 5,
    },
    routes: {
        label: 'Routes / Directions API',
        freeMonthlyRequests: Number(process.env.GMAPS_FREE_ROUTES || 40000),
        costPer1000Usd: 5,
    },
    distance_matrix: {
        label: 'Distance Matrix',
        freeMonthlyRequests: Number(process.env.GMAPS_FREE_DISTANCE_MATRIX || 40000),
        costPer1000Usd: 5,
    },
    maps_js: {
        label: 'Maps JavaScript API',
        freeMonthlyRequests: Number(process.env.GMAPS_FREE_MAPS_JS || 28000),
        costPer1000Usd: 7,
    },
    geolocation: {
        label: 'Geolocation API',
        freeMonthlyRequests: Number(process.env.GMAPS_FREE_GEOLOCATION || 40000),
        costPer1000Usd: 5,
    },
    places: {
        label: 'Places API',
        freeMonthlyRequests: Number(process.env.GMAPS_FREE_PLACES || 40000),
        costPer1000Usd: 5,
    },
};

const IMAGEKIT_FREE = {
    storageBytes: Number(process.env.IMAGEKIT_FREE_STORAGE_BYTES || 20 * 1024 * 1024 * 1024), // 20GB
    bandwidthBytes: Number(process.env.IMAGEKIT_FREE_BANDWIDTH_BYTES || 20 * 1024 * 1024 * 1024),
};

const MONGODB_ALERT_PCT = 80;
const MAPS_ALERT_THRESHOLDS = [50, 75, 90, 100];

function maskApiKey(key) {
    if (!key || typeof key !== 'string') return 'não configurada';
    if (key.length <= 8) return '••••';
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function pct(used, limit) {
    if (limit == null || limit <= 0 || used == null) return null;
    return Math.min(999, Math.round((used / limit) * 1000) / 10);
}

function healthFromPercent(percent, { warn = 50, crit = 90 } = {}) {
    if (percent == null) return 'unknown';
    if (percent >= crit) return 'critical';
    if (percent >= warn) return 'attention';
    return 'healthy';
}

function shiftDayKey(dayKey, deltaDays) {
    const d = new Date(`${dayKey}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
}

function monthBounds(now = new Date()) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        dayOfMonth: now.getUTCDate(),
        daysInMonth: end.getUTCDate(),
    };
}

module.exports = {
    GOOGLE_MAPS_SKUS,
    IMAGEKIT_FREE,
    MONGODB_ALERT_PCT,
    MAPS_ALERT_THRESHOLDS,
    maskApiKey,
    pct,
    healthFromPercent,
    shiftDayKey,
    monthBounds,
};
