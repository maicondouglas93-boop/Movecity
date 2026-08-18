// Fase D da experiência de corrida ativa (2026-08-03): matemática da navegação.
//
// Tudo aqui é função pura, sem dependência de biblioteca de mapa, DOM ou GPS — é o
// que permite testar de verdade o comportamento da câmera (bearing, terço inferior,
// zoom dinâmico, próxima manobra) sem precisar de um dispositivo com Google Maps real.

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

export const normalizeAngle = (deg) => ((deg % 360) + 360) % 360;

// Rumo (bearing) de `from` para `to`, em graus (0 = norte, 90 = leste).
export function computeBearing(from, to) {
    if (!from || !to) return null;
    const lat1 = toRad(from.lat);
    const lat2 = toRad(to.lat);
    const dLng = toRad(to.lng - from.lng);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return normalizeAngle(toDeg(Math.atan2(y, x)));
}

export function distanceMeters(from, to) {
    if (!from || !to) return null;
    const lat1 = toRad(from.lat);
    const lat2 = toRad(to.lat);
    const dLat = toRad(to.lat - from.lat);
    const dLng = toRad(to.lng - from.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Ponto a `meters` de distância de `origin`, na direção `bearingDeg`.
export function offsetPosition(origin, bearingDeg, meters) {
    if (!origin || !Number.isFinite(bearingDeg) || !Number.isFinite(meters)) return origin;
    const angular = meters / EARTH_RADIUS_M;
    const bearing = toRad(bearingDeg);
    const lat1 = toRad(origin.lat);
    const lng1 = toRad(origin.lng);

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
    );
    const lng2 = lng1 + Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );

    return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

// Escala Web Mercator: quantos metros do mundo real cabem em 1 pixel de tela.
// Precisa da latitude porque a projeção estica conforme se afasta do equador.
export function metersPerPixel(lat, zoom) {
    return (156543.03392 * Math.cos(toRad(lat))) / Math.pow(2, zoom);
}

// Menor caminho angular de `from` para `to`: -180..180 (evita o marcador girar 350°
// para a direita quando bastaria 10° para a esquerda ao cruzar o norte).
export function shortestAngleDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
}

// Interpolação angular pelo menor caminho. t em 0..1.
export function lerpAngle(from, to, t) {
    return normalizeAngle(from + shortestAngleDelta(from, to) * t);
}

export function lerp(from, to, t) {
    return from + (to - from) * t;
}

// Centro da câmera que coloca o veículo aproximadamente no terço inferior da tela:
// desloca o alvo para a FRENTE (na direção do movimento) por uma fração da altura do
// viewport. Sem isso, o veículo fica no meio da tela e o motorista enxerga tanta rua
// atrás quanto à frente — metade da tela desperdiçada.
export function cameraCenterForFollow({
    position,
    heading,
    zoom,
    viewportHeightPx,
    bottomInsetPx = 0,
    offsetRatio = 0.18,
}) {
    if (!position) return position;
    if (!Number.isFinite(heading) || !Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) {
        return position;
    }

    // O painel da corrida cobre a parte de baixo do mapa. Sem descontar essa faixa, o
    // veículo era posicionado a 18% abaixo do centro da tela INTEIRA e acabava atrás
    // do painel — o motorista perdia de vista a própria seta.
    //
    // Aqui a conta mira o centro da área realmente visível (a faixa acima do painel) e
    // só então aplica o deslocamento para a frente, que existe pra mostrar mais da rua
    // que vem do que da que ficou pra trás. Com inset 0 o resultado é idêntico ao de
    // antes, então nada muda onde não há painel.
    const inset = Number.isFinite(bottomInsetPx) && bottomInsetPx > 0
        ? Math.min(bottomInsetPx, viewportHeightPx * 0.6)
        : 0;
    const visibleHeightPx = viewportHeightPx - inset;
    const forwardPixels = (offsetRatio * visibleHeightPx) - (inset / 2);

    const forwardMeters = metersPerPixel(position.lat, zoom) * forwardPixels;
    return offsetPosition(position, heading, forwardMeters);
}

// Zoom dinâmico. Devagar/parado pede detalhe da esquina; rodovia pede contexto do que
// vem à frente. Aproximar-se de uma manobra sempre puxa o zoom para perto, porque é
// exatamente aí que os detalhes da via importam.
const SPEED_ZOOM_STEPS = [
    { maxKmh: 20, zoom: 18 },
    { maxKmh: 40, zoom: 17.5 },
    { maxKmh: 60, zoom: 17 },
    { maxKmh: 90, zoom: 16.5 },
];
const HIGHWAY_ZOOM = 16;
const MANEUVER_ZOOM = 18;
const MANEUVER_ZOOM_DISTANCE_M = 150;

export function dynamicZoom({ speedMps, distanceToManeuverM } = {}) {
    const kmh = Number.isFinite(speedMps) && speedMps > 0 ? speedMps * 3.6 : 0;
    let zoom = HIGHWAY_ZOOM;
    for (const step of SPEED_ZOOM_STEPS) {
        if (kmh < step.maxKmh) {
            zoom = step.zoom;
            break;
        }
    }
    if (Number.isFinite(distanceToManeuverM) && distanceToManeuverM <= MANEUVER_ZOOM_DISTANCE_M) {
        zoom = Math.max(zoom, MANEUVER_ZOOM);
    }
    return zoom;
}

// Distância a partir da qual a manobra é considerada cumprida e a navegação passa para
// a próxima. Generoso o bastante para tolerar o erro típico de GPS urbano (~15-25 m).
const STEP_REACHED_M = 35;

// Seleciona a próxima manobra. Monotônico de propósito: nunca volta para um passo já
// cumprido, mesmo que um salto de GPS aproxime o veículo de uma esquina anterior.
// `steps[].location` é o ponto onde a manobra acontece (fim do trecho).
export function pickNextStep(steps, position, fromIndex = 0) {
    if (!Array.isArray(steps) || steps.length === 0 || !position) {
        return { index: fromIndex, step: null, distanceMeters: null };
    }

    let index = Math.max(0, Math.min(fromIndex, steps.length - 1));
    while (index < steps.length) {
        const candidate = steps[index];
        const dist = candidate?.location ? distanceMeters(position, candidate.location) : null;
        if (dist == null || dist > STEP_REACHED_M) {
            return { index, step: candidate, distanceMeters: dist };
        }
        index += 1;
    }

    return { index: steps.length, step: null, distanceMeters: null };
}

// Formatação da distância no banner de manobra, no padrão que apps de navegação usam
// (metros arredondados de 10 em 10 perto, quilômetros com 1 casa longe).
export function formatManeuverDistance(meters) {
    if (!Number.isFinite(meters) || meters < 0) return '';
    if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
}

// Ícone (remixicon) da manobra. O backend normaliza `maneuver` para um conjunto
// pequeno e estável; qualquer valor desconhecido cai na seta de "siga em frente".
const MANEUVER_ICONS = {
    'turn-left': 'ri-corner-up-left-line',
    'turn-right': 'ri-corner-up-right-line',
    'turn-slight-left': 'ri-corner-up-left-line',
    'turn-slight-right': 'ri-corner-up-right-line',
    'turn-sharp-left': 'ri-corner-up-left-line',
    'turn-sharp-right': 'ri-corner-up-right-line',
    'uturn': 'ri-u-turn-line',
    'roundabout': 'ri-clockwise-line',
    'merge': 'ri-merge-cells-horizontal',
    'fork-left': 'ri-corner-up-left-line',
    'fork-right': 'ri-corner-up-right-line',
    'destination': 'ri-map-pin-2-fill',
    'straight': 'ri-arrow-up-line',
};

export function maneuverIcon(maneuver) {
    return MANEUVER_ICONS[maneuver] || MANEUVER_ICONS.straight;
}
