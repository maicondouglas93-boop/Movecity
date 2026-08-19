// Movimento de GPS real: emite 'update-location-captain' via socket real, o mesmo
// evento que o app do motorista emite em produção (socket.js). O backend acumula
// `actualDistance` via haversine real sobre esses pontos (ver socket.js linhas
// ~304-339) — nenhuma distância é escrita direto no banco.
//
// `services/__mocks__/maps.service.js` (usado por toda a suíte Jest via
// tests/setup/setup.js) reexporta `haversineKm` como a implementação REAL
// (jest.requireActual) — só geocoding de endereço é mockado. Por isso é seguro usar
// mapService.haversineKm aqui pra calcular a distância "planejada" que o simulador
// vai percorrer, exatamente com a mesma matemática que o backend usa pra acumular
// actualDistance.
const mapService = require('../../../services/maps.service');

function interpolatePoints(start, end, steps) {
    const points = [];
    for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        points.push({
            ltd: start.ltd + (end.ltd - start.ltd) * t,
            lng: start.lng + (end.lng - start.lng) * t,
        });
    }
    return points;
}

// socket.js só acumula actualDistance quando o salto entre dois pontos consecutivos
// está entre 5m e 2000m (filtro de precisão anti-GPS-glitch), e a PRIMEIRA emissão
// depois de 'started' só define lastLocation (0 acumulado) — é a semântica real do
// primeiro fix de GPS do motorista após apertar iniciar. Por isso o `start` (posição
// de embarque) é incluído como primeiro ponto da rota: ele "zera" a baseline de
// propósito, e os pontos seguintes é que efetivamente somam a distância real, cada um
// dentro da janela aceita pelo filtro.
function buildLinearRoute(start, end, { stepMeters = 500 } = {}) {
    const totalMeters = mapService.haversineKm(start.ltd, start.lng, end.ltd, end.lng) * 1000;
    const steps = Math.max(2, Math.round(totalMeters / stepMeters));
    return [start, ...interpolatePoints(start, end, steps)];
}

function routeDistanceMeters(points, start) {
    let total = 0;
    let prev = start;
    for (const point of points) {
        total += mapService.haversineKm(prev.ltd, prev.lng, point.ltd, point.lng) * 1000;
        prev = point;
    }
    return total;
}

// Velocidade urbana simulada. O backend recusa deslocamento acima de 60 m/s como
// impossível — o simulador precisa ficar bem abaixo disso para ser realista.
const DEFAULT_SPEED_MPS = 12; // ~43 km/h

/**
 * Dá a cada ponto da rota um horário coerente com a distância até o ponto anterior.
 *
 * Sem isto o simulador emite 500 m a cada ~50 ms — perto de 36.000 km/h. A validação de
 * velocidade do backend rejeita TODOS os pontos, a corrida fecha com distância zero e o
 * caminho que transforma GPS em dinheiro fica sem cobertura nenhuma.
 *
 * A linha do tempo TERMINA em `endTimeMs` e caminha para trás: horário futuro é recusado
 * (tolerância de 30 s), então a viagem simulada tem que já ter acontecido. Quem chama
 * precisa alinhar a corrida a ela — recuar `startedAt` e a âncora (`lastLocation` /
 * `lastLocationAt`) para antes do primeiro ponto. Sem isso os pontos chegam "antes do
 * início" ou "fora de ordem" e são recusados por outro motivo.
 */
function routeTimeline(points, { speedMps = DEFAULT_SPEED_MPS, endTimeMs = Date.now() } = {}) {
    const legs = [0];
    for (let i = 1; i < points.length; i += 1) {
        const meters = mapService.haversineKm(
            points[i - 1].ltd, points[i - 1].lng, points[i].ltd, points[i].lng
        ) * 1000;
        legs.push(legs[i - 1] + meters);
    }

    const totalSeconds = legs[legs.length - 1] / speedMps;
    const startMs = endTimeMs - Math.round(totalSeconds * 1000);
    const timestamps = legs.map((meters) => startMs + Math.round((meters / speedMps) * 1000));

    return { timestamps, startMs, endMs: endTimeMs, totalSeconds };
}

// Anda um ponto por vez. Quando existe corrida/encomenda ativa pro motorista, o
// handler real (socket.js) sempre ecoa 'captain-location-updated' de volta pro
// próprio socket que emitiu — esperamos esse eco pra garantir que o acúmulo de
// actualDistance já foi processado (compare-and-swap em lastLocation) antes de
// avançar. Sem corrida/encomenda ativa (ex.: fix inicial pra fixar a posição do
// motorista antes de aceitar uma oferta), o handler só grava captain.location e NÃO
// emite eco nenhum — `expectEcho:false` evita esperar por um evento que nunca chega.
async function driveRoute({ socket, points, delayMs = 20, timeoutMs = 5000, expectEcho = true, timeline = null }) {
    const timestamps = timeline?.timestamps || null;
    let index = -1;
    for (const rawPoint of points) {
        index += 1;
        // Com linha do tempo, cada ponto viaja com o horário simulado da captura — é o que
        // faz a validação de velocidade enxergar deslocamento possível, não teletransporte.
        const point = timestamps ? { ...rawPoint, timestamp: timestamps[index] } : rawPoint;
        if (expectEcho) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error('Timeout esperando captain-location-updated do servidor')),
                    timeoutMs
                );
                socket.once('captain-location-updated', (payload) => {
                    clearTimeout(timer);
                    resolve(payload);
                });
                socket.emit('update-location-captain', { location: point });
            });
        } else {
            socket.emit('update-location-captain', { location: point });
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, Math.max(delayMs, 50)));
        }
        if (delayMs && expectEcho) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

module.exports = { interpolatePoints, buildLinearRoute, routeDistanceMeters, routeTimeline, driveRoute, DEFAULT_SPEED_MPS };
