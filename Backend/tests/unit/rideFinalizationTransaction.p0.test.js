jest.mock('../../services/maps.service', () => ({
    haversineKm: jest.fn(() => 1),
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
        fareBreakdown: { subtotal: 250, finalFare: 250, platformCommission: 25 },
    }),
}));

jest.mock('../../models/ride.model', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
}));

jest.mock('../../models/payment.model', () => ({
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn(),
}));

jest.mock('../../models/user.model', () => ({
    findByIdAndUpdate: jest.fn(),
    findOneAndUpdate: jest.fn(),
}));

jest.mock('../../models/captain.model', () => ({
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
}));

const mongoose = require('mongoose');
const rideModel = require('../../models/ride.model');
const paymentModel = require('../../models/payment.model');
const captainModel = require('../../models/captain.model');
const PricingEngine = require('../../services/pricingEngine.service');
const rideService = require('../../services/ride.service');

function populated(value) {
    const chain = {
        populate: jest.fn(() => chain),
        select: jest.fn(async () => value),
    };
    return chain;
}

function finalResult(value) {
    const second = { populate: jest.fn(async () => value) };
    return { populate: jest.fn(() => second) };
}

function setupFinalization({ paymentError = null, rideOverrides = {} } = {}) {
    const startedAt = new Date(Date.now() - 150 * 60 * 1000);
    const initial = {
        _id: 'ride1',
        source: 'driver_initiated',
        status: 'started',
        destinationPending: true,
        captain: 'cap1',
        user: null,
        vehicleType: 'car',
        paymentMethod: 'cash',
        pickupCoordinates: { lat: -19.5586, lng: -41.6803 },
        origin: { coordinates: [-41.6803, -19.5586] },
        fare: 0,
        actualDistance: 80000,
        lastLocation: { lat: -19.5586, lng: -41.6803 },
        lastLocationAt: new Date(),
        startedAt,
        optionals: [],
    };
    Object.assign(initial, rideOverrides);
    const claimed = { ...initial, finalizationState: 'finishing', finalizationStartedAt: new Date() };
    const finished = {
        ...claimed,
        status: 'finished',
        destination: claimed.destination || 'Lajinha, MG',
        destinationPending: false,
        finalPrice: 250,
        actualTime: 9000,
        commissionAmount: 25,
        finalizationState: 'finished_pending_payment',
    };

    rideModel.findOne.mockReturnValue(populated(initial));
    rideModel.findOneAndUpdate.mockImplementation((filter, update) => {
        if (update.$set?.finalizationState === 'finishing' && !update.$set?.status) {
            return populated(claimed);
        }
        if (update.$set?.status === 'finished') return Promise.resolve(finished);
        return Promise.resolve(null);
    });
    rideModel.findById.mockReturnValue(finalResult(finished));
    captainModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
            location: { ltd: -19.5586, lng: -41.6803 },
            lastSeenAt: new Date(),
        }),
    });
    captainModel.findByIdAndUpdate.mockResolvedValue({ _id: 'cap1', busyLock: false });
    if (paymentError) paymentModel.findOneAndUpdate.mockRejectedValueOnce(paymentError);
    else paymentModel.findOneAndUpdate.mockResolvedValue({ rideId: 'ride1', amount: 250 });

    const session = {
        withTransaction: jest.fn(async callback => callback()),
        endSession: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);

    // Este arquivo testa a fiação de transação/sessão da PRÓPRIA finalização, não a
    // liquidação financeira (isso é coberto com banco real em rideFinalization.p0.test.js).
    // Desde 2026-08-16, endRide chama confirmPaymentReceived pra qualquer método de
    // pagamento logo depois de finalizar — mockado aqui pra manter o foco do teste.
    const confirmPaymentReceivedSpy = jest.spyOn(rideService, 'confirmPaymentReceived')
        .mockResolvedValue(undefined);

    return { initial, finished, session, confirmPaymentReceivedSpy };
}

describe('transação da finalização P0', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    it('grava finished, payment e liberação do motorista na mesma session', async () => {
        const { session, confirmPaymentReceivedSpy } = setupFinalization();
        const captain = { _id: 'cap1' };
        const result = await rideService.endRide({ rideId: 'ride1', captain });

        expect(result.status).toBe('finished');
        expect(session.withTransaction).toHaveBeenCalledTimes(1);

        const finishCall = rideModel.findOneAndUpdate.mock.calls.find(([, update]) => update.$set?.status === 'finished');
        expect(finishCall[2]).toEqual(expect.objectContaining({ session }));
        expect(paymentModel.findOneAndUpdate.mock.calls[0][2]).toEqual(expect.objectContaining({ session }));
        expect(captainModel.findByIdAndUpdate.mock.calls.at(-1)[2]).toEqual(expect.objectContaining({ session }));

        // Liquidação (comissão + repasse) dispara logo após finalizar, pra qualquer
        // método de pagamento — não só carteira (2026-08-16).
        expect(confirmPaymentReceivedSpy).toHaveBeenCalledWith({
            rideId: 'ride1',
            captain,
            allowWalletAuto: true,
        });
    });

    it('falha financeira mantém caminho explícito de retry após rollback transacional', async () => {
        setupFinalization({ paymentError: new Error('PAYMENT_WRITE_FAILED') });

        await expect(rideService.endRide({ rideId: 'ride1', captain: { _id: 'cap1' } }))
            .rejects.toThrow('PAYMENT_WRITE_FAILED');

        expect(rideModel.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'started', finalizationState: 'finishing' }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    finalizationState: 'retry_required',
                    finalizationError: 'PAYMENT_WRITE_FAILED',
                }),
            })
        );
    });

    it('preserva uma corrida normal com destino previamente informado', async () => {
        setupFinalization({
            rideOverrides: {
                source: 'user_requested',
                destinationPending: false,
                destination: 'Ibatiba, ES',
                destinationCoordinates: { lat: -20.233, lng: -41.510 },
                actualDistance: 40000,
            },
        });

        const result = await rideService.endRide({ rideId: 'ride1', captain: { _id: 'cap1' } });

        expect(PricingEngine.calculateFare).toHaveBeenCalledWith(expect.objectContaining({
            distance: 40000,
            serviceKind: 'ride',
        }));
        expect(result.destination).toBe('Ibatiba, ES');
        expect(result.destinationCoordinates).toEqual({ lat: -20.233, lng: -41.510 });
        expect(result.status).toBe('finished');
    });
});
