jest.mock('../../services/maps.service', () => ({
    haversineKm: jest.fn(() => 0.01),
    getReverseGeocode: jest.fn().mockResolvedValue({ address: 'Lajinha, MG' }),
    getDistanceTime: jest.fn(),
    getAddressCoordinate: jest.fn(),
}));

// Corrida real (final 250) bem mais cara que a estimativa (100) — o cenário que
// expõe o bug: sem recalcular, o desconto do cupom simplesmente sumia na finalização.
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
            surcharges: {},
            subtotal: 250,
            finalFare: 250,
            platformCommission: 25,
            driverNetEarnings: 225,
        },
    }),
}));

const rideModel = require('../../models/ride.model');
const promotionModel = require('../../models/promotion.model');
const promotionUsageModel = require('../../models/promotionUsage.model');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');
const rideService = require('../../services/ride.service');

const LAJINHA = { lat: -19.5586, lng: -41.6803 };

async function createRideWithPromotion({ discountType, value, maxDiscountLimit, estimatedDiscount }) {
    const captain = await createCaptain({
        busyLock: true,
        isOnline: true,
        location: { ltd: LAJINHA.lat, lng: LAJINHA.lng },
        lastSeenAt: new Date(),
    });
    const user = await createUser();

    const promotion = await promotionModel.create({
        code: `TESTE${Date.now()}`,
        title: 'Cupom de teste',
        discountType,
        value,
        maxDiscountLimit,
        startDate: new Date(Date.now() - 60 * 60 * 1000),
        currentBudgetUsed: estimatedDiscount,
        metrics: { totalDiscountGiven: estimatedDiscount },
    });

    // Estimativa: fare (base, sem desconto) = 100; finalPrice (mostrado ao
    // passageiro) = 100 - estimatedDiscount, exatamente como createRide grava hoje.
    const ride = await rideModel.create({
        source: 'passenger_requested',
        user: user._id,
        captain: captain._id,
        pickup: 'Lajinha, MG',
        destination: 'Manhuaçu, MG',
        pickupCoordinates: LAJINHA,
        destinationCoordinates: { lat: -20.2589, lng: -42.0264 },
        origin: { coordinates: [LAJINHA.lng, LAJINHA.lat], timestamp: new Date() },
        fare: 100,
        finalPrice: 100 - estimatedDiscount,
        promotionApplied: promotion._id,
        discountAmount: estimatedDiscount,
        vehicleType: 'car',
        paymentMethod: 'pix',
        otp: '123456',
        status: 'started',
        startedAt: new Date(Date.now() - 40 * 60 * 1000),
        actualDistance: 80000,
        lastLocation: LAJINHA,
        lastLocationAt: new Date(),
        optionals: [],
    });

    await promotionUsageModel.create({
        promotionId: promotion._id,
        userId: user._id,
        rideId: ride._id,
        discountAmount: estimatedDiscount,
    });

    return { captain, user, promotion, ride };
}

describe('promoção recalculada sobre o valor final (Fase 3.2, COR-3001)', () => {
    it('cupom percentual: recalcula o desconto sobre o valor final, não trava na estimativa', async () => {
        // Estimativa: 100 * 20% = 20 de desconto. Final real: 250 * 20% = 50.
        const { ride, promotion, captain } = await createRideWithPromotion({
            discountType: 'percentage',
            value: 20,
            estimatedDiscount: 20,
        });

        await rideService.endRide({ rideId: ride._id, captain: { _id: captain._id } });
        const finished = await rideModel.findById(ride._id);

        expect(finished.discountAmount).toBe(50);
        expect(finished.finalPrice).toBe(200); // 250 - 50

        const updatedPromotion = await promotionModel.findById(promotion._id);
        // 20 (já registrado na criação) + 30 (diferença) = 50
        expect(updatedPromotion.currentBudgetUsed).toBe(50);
        expect(updatedPromotion.metrics.totalDiscountGiven).toBe(50);

        const usage = await promotionUsageModel.findOne({ rideId: ride._id });
        expect(usage.discountAmount).toBe(50);
    });

    it('cupom fixo com teto: nunca desconta mais que o maxDiscountLimit', async () => {
        const { ride, captain } = await createRideWithPromotion({
            discountType: 'fixed',
            value: 15,
            maxDiscountLimit: 15,
            estimatedDiscount: 15,
        });

        await rideService.endRide({ rideId: ride._id, captain: { _id: captain._id } });
        const finished = await rideModel.findById(ride._id);

        expect(finished.discountAmount).toBe(15);
        expect(finished.finalPrice).toBe(235); // 250 - 15
    });

    it('corrida sem cupom não é afetada (regressão)', async () => {
        const captain = await createCaptain({
            busyLock: true,
            isOnline: true,
            location: { ltd: LAJINHA.lat, lng: LAJINHA.lng },
            lastSeenAt: new Date(),
        });
        const user = await createUser();
        const ride = await rideModel.create({
            source: 'passenger_requested',
            user: user._id,
            captain: captain._id,
            pickup: 'Lajinha, MG',
            destination: 'Manhuaçu, MG',
            pickupCoordinates: LAJINHA,
            destinationCoordinates: { lat: -20.2589, lng: -42.0264 },
            origin: { coordinates: [LAJINHA.lng, LAJINHA.lat], timestamp: new Date() },
            fare: 100,
            finalPrice: 100,
            vehicleType: 'car',
            paymentMethod: 'pix',
            otp: '123456',
            status: 'started',
            startedAt: new Date(Date.now() - 40 * 60 * 1000),
            actualDistance: 80000,
            lastLocation: LAJINHA,
            lastLocationAt: new Date(),
            optionals: [],
        });

        await rideService.endRide({ rideId: ride._id, captain: { _id: captain._id } });
        const finished = await rideModel.findById(ride._id);

        expect(finished.discountAmount).toBe(0);
        expect(finished.finalPrice).toBe(250);
    });
});
