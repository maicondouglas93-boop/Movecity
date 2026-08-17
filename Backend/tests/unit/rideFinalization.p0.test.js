jest.mock('../../services/maps.service', () => ({
    haversineKm: jest.fn((aLat, aLng, bLat, bLng) => {
        const toRad = value => (value * Math.PI) / 180;
        const earthKm = 6371;
        const dLat = toRad(bLat - aLat);
        const dLng = toRad(bLng - aLng);
        const value = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
        return earthKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
    }),
    getReverseGeocode: jest.fn().mockResolvedValue({ address: 'Lajinha, MG' }),
    getDistanceTime: jest.fn(),
    getAddressCoordinate: jest.fn(),
}));

jest.mock('../../services/pricingEngine.service', () => ({
    buildConfigSnapshot: jest.fn(),
    calculateFare: jest.fn().mockResolvedValue({
        finalFare: 250,
        commissionAmount: 25,
        commissionPercent: 10,
        fareBreakdown: {
            baseFare: 10,
            distanceFare: 160,
            timeFare: 75,
            surcharges: { optionals: 5 },
            subtotal: 250,
            finalFare: 250,
            platformCommission: 25,
            driverNetEarnings: 225,
        },
    }),
}));

const rideModel = require('../../models/ride.model');
const paymentModel = require('../../models/payment.model');
const transactionModel = require('../../models/transaction.model');
const captainModel = require('../../models/captain.model');
const { createCaptain } = require('../factories/captain.factory');
const rideService = require('../../services/ride.service');
const PricingEngine = require('../../services/pricingEngine.service');

const LAJINHA = { lat: -19.5586, lng: -41.6803 };

async function createFinancialRide() {
    const captain = await createCaptain({
        busyLock: true,
        isOnline: true,
        location: { ltd: LAJINHA.lat, lng: LAJINHA.lng },
        lastSeenAt: new Date(),
    });
    const ride = await rideModel.create({
        source: 'driver_initiated',
        captain: captain._id,
        pickup: 'Lajinha, MG',
        destinationPending: true,
        pickupCoordinates: LAJINHA,
        origin: { coordinates: [LAJINHA.lng, LAJINHA.lat], timestamp: new Date() },
        fare: 0,
        vehicleType: 'car',
        paymentMethod: 'cash',
        otp: '123456',
        status: 'started',
        startedAt: new Date(Date.now() - 150 * 60 * 1000),
        actualDistance: 80000,
        lastLocation: LAJINHA,
        lastLocationAt: new Date(),
        optionals: [],
    });
    return { captain, ride };
}

// Presencial sem destino: o destino sai da última GPS válida, então a finalização
// valida a idade dessa posição. `lastLocationAt` controla quão "velha" ela é.
async function createPresentialRideWithLastLocationAt(lastLocationAt) {
    const captain = await createCaptain({
        busyLock: true,
        isOnline: true,
        location: { ltd: LAJINHA.lat, lng: LAJINHA.lng },
        lastSeenAt: lastLocationAt,
    });
    const ride = await rideModel.create({
        source: 'driver_initiated',
        captain: captain._id,
        pickup: 'Lajinha, MG',
        destinationPending: true,
        pickupCoordinates: LAJINHA,
        origin: { coordinates: [LAJINHA.lng, LAJINHA.lat], timestamp: new Date() },
        fare: 0,
        vehicleType: 'car',
        paymentMethod: 'cash',
        otp: '123456',
        status: 'started',
        startedAt: new Date(Date.now() - 150 * 60 * 1000),
        actualDistance: 80000,
        lastLocation: LAJINHA,
        lastLocationAt,
        optionals: [],
    });
    return { captain, ride };
}

describe('finalização financeira P0', () => {
    it('dupla finalização produz uma corrida e um único ledger financeiro', async () => {
        const { captain, ride } = await createFinancialRide();

        // Comissão/repasse liquidam na própria finalização agora (2026-08-16), pra
        // qualquer método de pagamento — não mais só depois de um toque separado do
        // motorista em "pagamento recebido". A dupla finalização concorrente (duplo
        // clique / retry de rede) continua produzindo um único ledger financeiro.
        const endResults = await Promise.allSettled([
            rideService.endRide({ rideId: ride._id, captain }),
            rideService.endRide({ rideId: ride._id, captain }),
        ]);
        expect(endResults.some(result => result.status === 'fulfilled')).toBe(true);

        const storedRide = await rideModel.findById(ride._id);
        expect(storedRide.status).toBe('finished');
        expect(storedRide.actualDistance).toBe(80000);
        expect(storedRide.finalPrice).toBe(250);
        expect(storedRide.finalizationState).toBe('completed');
        expect(storedRide.paymentStatus).toBe('paid');
        expect(await paymentModel.countDocuments({ rideId: ride._id, status: 'approved' })).toBe(1);
        expect(await transactionModel.countDocuments({ rideId: ride._id, type: 'ride_payment' })).toBe(1);
        expect(await transactionModel.countDocuments({ rideId: ride._id, type: 'commission' })).toBe(1);

        const releasedCaptain = await captainModel.findById(captain._id);
        expect(releasedCaptain.busyLock).toBe(false);

        // O toque manual em "pagamento recebido" ainda existe como fallback, mas
        // como a liquidação já aconteceu, ele agora é sempre rejeitado — prova que
        // não dá pra pagar a mesma corrida duas vezes por esse caminho.
        await expect(rideService.confirmPaymentReceived({ rideId: ride._id, captain }))
            .rejects.toThrow('Payment already confirmed');
        expect(await transactionModel.countDocuments({ rideId: ride._id, type: 'ride_payment' })).toBe(1);
        expect(await transactionModel.countDocuments({ rideId: ride._id, type: 'commission' })).toBe(1);
    });

    it('falha ao criar pagamento reverte finished e mantém retry seguro', async () => {
        const { captain, ride } = await createFinancialRide();
        const paymentWrite = jest.spyOn(paymentModel, 'findOneAndUpdate')
            .mockRejectedValueOnce(new Error('PAYMENT_WRITE_FAILED'));

        await expect(rideService.endRide({ rideId: ride._id, captain }))
            .rejects.toThrow('PAYMENT_WRITE_FAILED');
        paymentWrite.mockRestore();

        const storedRide = await rideModel.findById(ride._id);
        const storedCaptain = await captainModel.findById(captain._id);
        expect(storedRide.status).toBe('started');
        expect(storedRide.finalizationState).toBe('retry_required');
        expect(storedRide.paymentStatus).toBe('pending');
        expect(storedCaptain.busyLock).toBe(true);
        expect(await paymentModel.countDocuments({ rideId: ride._id })).toBe(0);
        expect(await transactionModel.countDocuments({ rideId: ride._id })).toBe(0);
    });

    it('usa o timestamp real de finishLocation pro tempo da corrida, não o Date.now() do servidor (finalização offline atrasada)', async () => {
        const { captain, ride } = await createFinancialRide();
        // ride.startedAt está 150min no passado (createFinancialRide). Simula uma
        // finalização que na verdade aconteceu 10min depois do início, mas cuja
        // requisição só chega no servidor bem mais tarde — mesmo efeito de uma ação
        // enfileirada offline (sem sinal) que demora pra sincronizar.
        const realFinishMs = new Date(ride.startedAt).getTime() + 10 * 60 * 1000;

        await rideService.endRide({
            rideId: ride._id,
            captain,
            finishLocation: { lat: LAJINHA.lat, lng: LAJINHA.lng, accuracy: 10, timestamp: realFinishMs },
        });

        expect(PricingEngine.calculateFare).toHaveBeenCalledWith(
            expect.objectContaining({ time: 600 })
        );
    });

    // Regressão do achado 01 da auditoria de corrida ativa (2026-08-16): zona rural sem
    // sinal. O motorista finaliza offline, a ação fica na fila e só sincroniza quando o
    // sinal volta — às vezes uma hora depois. A validação de GPS da presencial comparava
    // a idade da posição com Date.now() (o instante em que a requisição CHEGA), então
    // reprovava com STALE_FINISH_LOCATION → 400 → a fila offline descarta 4xx como
    // definitivo → corrida presa em `started` pra sempre, motorista sem receber.
    it('finaliza presencial sincronizada muito depois, desde que a GPS fosse fresca no fim real', async () => {
        const finishedAt = Date.now() - 60 * 60 * 1000; // motorista finalizou 1h atrás
        const { captain, ride } = await createPresentialRideWithLastLocationAt(
            new Date(finishedAt - 10 * 60 * 1000)
        );

        const finished = await rideService.endRide({
            rideId: ride._id,
            captain,
            finishLocation: {
                lat: LAJINHA.lat,
                lng: LAJINHA.lng,
                accuracy: 10,
                timestamp: finishedAt,
            },
        });

        expect(finished.status).toBe('finished');
        // Cobra só até o fim real (150min de início → 60min atrás = 90min), não as 150min
        // que teriam saído do relógio do servidor no momento da sincronização.
        expect(PricingEngine.calculateFare).toHaveBeenCalledWith(
            expect.objectContaining({ time: 5400 })
        );
    });

    it('mantém a recusa quando a GPS já estava velha no momento do fim', async () => {
        const finishedAt = Date.now() - 60 * 60 * 1000;
        // Última posição conhecida é 30min ANTERIOR ao fim declarado: não dá pra saber
        // onde a corrida terminou, então inventar destino/preço continua proibido.
        const { captain, ride } = await createPresentialRideWithLastLocationAt(
            new Date(finishedAt - 30 * 60 * 1000)
        );

        await expect(rideService.endRide({
            rideId: ride._id,
            captain,
            // Sem finishLocation: nada atualiza a posição, a última válida segue velha.
        })).rejects.toMatchObject({ code: 'STALE_FINISH_LOCATION' });

        const stored = await rideModel.findById(ride._id);
        expect(stored.status).toBe('started');
    });

    it('ignora finishLocation.timestamp implausível (no futuro) e cai de volta pro relógio do servidor', async () => {
        const { captain, ride } = await createFinancialRide();
        const futureMs = Date.now() + 60 * 60 * 1000;

        await rideService.endRide({
            rideId: ride._id,
            captain,
            finishLocation: { lat: LAJINHA.lat, lng: LAJINHA.lng, accuracy: 10, timestamp: futureMs },
        });

        const lastCall = PricingEngine.calculateFare.mock.calls.at(-1)[0];
        // startedAt foi ~150min atrás; com o timestamp futuro descartado, o tempo
        // calculado precisa refletir isso (relógio do servidor), não a diferença até o futuro.
        expect(lastCall.time).toBeGreaterThan(9000 - 5);
        expect(lastCall.time).toBeLessThan(9000 + 30);
    });
});
