const mockState = {};

jest.mock('../../services/maps.service', () => ({
    haversineKm: jest.requireActual('../../services/maps/geo.util').haversineKm,
}));

function mockFilterMatches(filter) {
    if (filter.status && mockState.status !== filter.status) return false;
    if (filter.processedTrackingPointIds?.$ne
        && mockState.processedTrackingPointIds.includes(filter.processedTrackingPointIds.$ne)) return false;
    if (filter['lastLocation.lat'] != null && mockState.lastLocation?.lat !== filter['lastLocation.lat']) return false;
    if (filter['lastLocation.lng'] != null && mockState.lastLocation?.lng !== filter['lastLocation.lng']) return false;
    if (filter.lastLocationAt
        && new Date(mockState.lastLocationAt).getTime() !== new Date(filter.lastLocationAt).getTime()) return false;
    if (filter.$or && mockState.lastLocation?.lat != null) return false;
    return true;
}

jest.mock('../../models/ride.model', () => ({
    findOne: jest.fn(() => ({
        select: jest.fn(async () => ({
            ...mockState,
            processedTrackingPointIds: [...mockState.processedTrackingPointIds],
        })),
    })),
    findOneAndUpdate: jest.fn(async (filter, update) => {
        if (!mockFilterMatches(filter)) return null;
        if (update.$inc?.actualDistance) mockState.actualDistance += update.$inc.actualDistance;
        if (update.$set) Object.assign(mockState, update.$set);
        const pushed = update.$push?.processedTrackingPointIds;
        if (pushed) {
            (pushed.$each || [pushed]).forEach((id) => {
                if (!mockState.processedTrackingPointIds.includes(id)) mockState.processedTrackingPointIds.push(id);
            });
        }
        return { ...mockState };
    }),
}));

const { processRideTrackingPoint } = require('../../services/rideTracking.service');

/**
 * Âncora do contador de distância de uma corrida.
 *
 * Achado L1 da auditoria de localização/preço (2026-08-18): startRide gravava a posição
 * GUARDADA do motorista carimbada com o horário de AGORA. O carimbo era o problema — a
 * validação de velocidade comparava cada GPS real contra um ponto possivelmente de horas
 * antes, como se tivesse acabado de ser capturado.
 *
 * Efeito medido: os primeiros pontos eram rejeitados por "velocidade impossível"
 * (distância perdida) e, quando o tempo decorrido já permitia o salto, os ~3,3 km entre
 * a âncora velha e a posição real eram somados e cobrados — sem o carro sair do lugar.
 */
describe('âncora de distância da corrida', () => {
    const T0 = Date.now();
    // Motorista realmente aqui; a posição antiga do servidor fica ~3,3 km ao norte.
    const REAL = { lat: -20.1200, lng: -41.6300 };
    const ANTIGA = { lat: -20.1500, lng: -41.6300 };

    function iniciarCorrida({ lastLocation, lastLocationAt }) {
        Object.keys(mockState).forEach((k) => delete mockState[k]);
        Object.assign(mockState, {
            _id: 'ride1',
            captain: 'cap1',
            status: 'started',
            actualDistance: 0,
            processedTrackingPointIds: [],
            startedAt: new Date(T0),
            ...(lastLocation ? { lastLocation, lastLocationAt } : {}),
        });
    }

    const enviarPonto = (offsetSec, pos) => processRideTrackingPoint({
        rideId: 'ride1',
        captainId: 'cap1',
        pointId: `p${offsetSec}`,
        location: { ltd: pos.lat, lng: pos.lng, accuracy: 5, timestamp: T0 + offsetSec * 1000 },
        now: T0 + offsetSec * 1000,
    });

    describe('sem âncora (posição do servidor era velha e foi descartada)', () => {
        beforeEach(() => iniciarCorrida({}));

        it('o primeiro GPS vira a âncora, sem contar distância', async () => {
            const r = await enviarPonto(5, REAL);

            expect(r.accepted).toBe(true);
            expect(r.countedDistanceMeters).toBe(0);
            expect(mockState.actualDistance).toBe(0);
            expect(mockState.lastLocation).toEqual({ lat: REAL.lat, lng: REAL.lng });
        });

        it('conta só o deslocamento real a partir daí', async () => {
            await enviarPonto(5, REAL);
            // ~111 m ao sul, em 10 s (~40 km/h): deslocamento plausível.
            await enviarPonto(15, { lat: REAL.lat - 0.001, lng: REAL.lng });

            expect(Math.round(mockState.actualDistance)).toBeGreaterThan(100);
            expect(Math.round(mockState.actualDistance)).toBeLessThan(130);
        });

        // O que o bug fazia: somar o vão entre a âncora velha e a posição real.
        it('nunca cobra o salto fantasma da posição antiga', async () => {
            await enviarPonto(5, REAL);
            await enviarPonto(70, REAL);

            expect(mockState.actualDistance).toBeLessThan(50);
        });
    });

    describe('com âncora recente, carimbada com a hora real', () => {
        // Posição de 30 s atrás — dentro da janela de frescor.
        beforeEach(() => iniciarCorrida({
            lastLocation: { lat: REAL.lat - 0.002, lng: REAL.lng },
            lastLocationAt: new Date(T0 - 30 * 1000),
        }));

        it('conta o trecho desde a âncora, sem perder o começo da corrida', async () => {
            const r = await enviarPonto(5, REAL);

            expect(r.accepted).toBe(true);
            // ~222 m percorridos entre a captura da âncora e este ponto.
            expect(Math.round(mockState.actualDistance)).toBeGreaterThan(180);
            expect(Math.round(mockState.actualDistance)).toBeLessThan(260);
        });
    });
});
