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

// Anda um ponto por vez. Quando existe corrida/encomenda ativa pro motorista, o
// handler real (socket.js) sempre ecoa 'captain-location-updated' de volta pro
// próprio socket que emitiu — esperamos esse eco pra garantir que o acúmulo de
// actualDistance já foi processado (compare-and-swap em lastLocation) antes de
// avançar. Sem corrida/encomenda ativa (ex.: fix inicial pra fixar a posição do
// motorista antes de aceitar uma oferta), o handler só grava captain.location e NÃO
// emite eco nenhum — `expectEcho:false` evita esperar por um evento que nunca chega.
async function driveRoute({ socket, points, delayMs = 20, timeoutMs = 5000, expectEcho = true }) {
    for (const point of points) {
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

module.exports = { interpolatePoints, buildLinearRoute, routeDistanceMeters, driveRoute };
