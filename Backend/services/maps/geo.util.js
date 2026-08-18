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

// "Parece um par de coordenadas?" — usado para decidir se vale geocodificar como
// endereço de texto. Só números, vírgula e espaços: qualquer letra indica endereço.
const COORD_SHAPED = /^\s*-?[\d.]+\s*,\s*-?[\d.]+\s*$/;
// Aceita inteiro ("-20"), decimal ("-20.15") e o par embutido no fim de um endereço.
// A versão anterior exigia decimal nos DOIS lados (`\d+\.\d+`), então uma coordenada
// redonda — que o JavaScript escreve como "-20", não "-20.0" — não casava e caía na
// geocodificação por texto, devolvendo um lugar aleatório do mundo.
const NUM = '(-?\\d+(?:\\.\\d+)?)';
const EMBEDDED_COORDS = new RegExp(`\\(${NUM},\\s*${NUM}\\)$`);
const BARE_COORDS = new RegExp(`^${NUM},\\s*${NUM}$`);

function isCoordinatePair(ltd, lng) {
    return Number.isFinite(ltd) && Number.isFinite(lng)
        && ltd >= -90 && ltd <= 90
        && lng >= -180 && lng <= 180;
}

/**
 * Extrai coordenadas de "Endereço (lat, lng)" ou de um par cru "lat,lng".
 *
 * Devolve `null` quando o texto é mesmo um endereço (para geocodificar normalmente) e
 * LANÇA quando o texto tem cara de coordenada mas não dá para ler. Essa distinção é o
 * ponto: antes, um par mal formatado virava busca de endereço no provider de mapas,
 * que respondia com um lugar qualquer — foi assim que uma corrida dentro de Lajinha
 * virou uma rota de 10.554 km e R$ 36.946.
 */
function extractEmbeddedCoords(address) {
    const text = String(address ?? '');
    const match = text.match(EMBEDDED_COORDS) || text.match(BARE_COORDS);

    if (match) {
        const ltd = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (isCoordinatePair(ltd, lng)) return { ltd, lng };
        throw new Error(`Coordenadas fora de faixa: "${text}"`);
    }

    if (COORD_SHAPED.test(text)) {
        throw new Error(`Coordenadas ilegíveis: "${text}"`);
    }

    return null;
}

module.exports = {
    haversineKm,
    approximateRouteFromCoords,
    extractEmbeddedCoords,
    isCoordinatePair,
};
