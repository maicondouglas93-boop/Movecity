// Matemática pura de geolocalização — não depende de nenhum provider (OSM ou Google).

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

// Último recurso quando o roteador (OSRM/GraphHopper/Routes API) falha, mas as
// coordenadas de origem/destino JÁ são reais. Não inventa local — só estima
// distância em linha reta e tempo a ~30 km/h urbano.
function approximateRouteFromCoords(originCoords, destCoords) {
    const km = haversineKm(
        originCoords.ltd, originCoords.lng,
        destCoords.ltd, destCoords.lng
    );
    if (!Number.isFinite(km)) {
        throw new Error('Unable to approximate route from coordinates');
    }
    const meters = Math.round(km * 1000);
    const seconds = Math.max(60, Math.round((km / 30) * 3600));
    return {
        distance: { text: `${km.toFixed(1)} km`, value: meters },
        duration: { text: `${Math.round(seconds / 60)} mins`, value: seconds },
        polyline: [
            [originCoords.ltd, originCoords.lng],
            [destCoords.ltd, destCoords.lng],
        ],
    };
}

module.exports = { haversineKm, approximateRouteFromCoords };
