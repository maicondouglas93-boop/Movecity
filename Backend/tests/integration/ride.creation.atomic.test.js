jest.mock('../../services/maps.service', () => ({
    getDistanceTime: jest.fn().mockResolvedValue({
        distance: { value: 5000 },
        duration: { value: 900 },
    }),
    getAddressCoordinate: jest.fn().mockResolvedValue({ ltd: -20.1, lng: -41.6 }),
    haversineKm: jest.fn().mockReturnValue(1),
    getCaptainsInTheRadius: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/pricingEngine.service', () => ({
    buildConfigSnapshot: jest.fn().mockResolvedValue({
        globalSetting: { platformCommission: 20 },
        category: { name: 'car', pricing: { optionals: [] } },
        tariffSetting: {},
        rules: [],
    }),
    calculateFare: jest.fn().mockResolvedValue({
        finalFare: 20,
        commissionPercent: 20,
        commissionAmount: 4,
        fareBreakdown: { platformCommission: 4, baseFare: 5 },
    }),
}));

jest.mock('../../services/dispatch.service', () => ({
    ACTIVE_PARCEL_STATUSES: ['accepted', 'picking_up', 'in_transit'],
    isVehicleCategoryAllowed: jest.fn().mockResolvedValue(true),
}));

const rideService = require('../../services/ride.service');
const rideModel = require('../../models/ride.model');
const paymentModel = require('../../models/payment.model');
const userModel = require('../../models/user.model');
const userWalletTransactionModel = require('../../models/userWalletTransaction.model');
const promotionUsageModel = require('../../models/promotionUsage.model');
const { createUser } = require('../factories/user.factory');

const requestData = (user, idempotencyKey) => ({
    user: user._id,
    pickup: 'Rua A, Centro',
    destination: 'Rua B, Centro',
    vehicleType: 'car',
    paymentMethod: 'pix',
    useWalletBalance: true,
    idempotencyKey,
});

describe('criação atômica e idempotente de corrida', () => {
    beforeAll(async () => {
        await Promise.all([
            rideModel.syncIndexes(),
            paymentModel.syncIndexes(),
            userWalletTransactionModel.syncIndexes(),
            promotionUsageModel.syncIndexes(),
        ]);
    });

    it('20 comandos concorrentes com a mesma chave produzem uma corrida e um débito', async () => {
        const user = await createUser({
            email: `atomic_${Date.now()}@test.com`,
            walletBalance: 100,
        });
        const key = '11111111-1111-4111-8111-111111111111';

        const results = await Promise.all(
            Array.from({ length: 20 }, () => rideService.createRide(requestData(user, key)))
        );

        expect(new Set(results.map(({ ride }) => String(ride._id))).size).toBe(1);
        expect(results.filter(({ replayed }) => replayed).length).toBe(19);
        expect(await rideModel.countDocuments({ user: user._id })).toBe(1);
        expect(await paymentModel.countDocuments({ userId: user._id })).toBe(1);
        expect(await userWalletTransactionModel.countDocuments({ userId: user._id })).toBe(1);

        const freshUser = await userModel.findById(user._id);
        expect(freshUser.walletBalance).toBe(80);
    });

    it('falha depois do débito planejado reverte corrida, saldo, ledger e payment', async () => {
        const user = await createUser({
            email: `rollback_${Date.now()}@test.com`,
            walletBalance: 100,
        });
        const key = '22222222-2222-4222-8222-222222222222';
        const createPayment = jest.spyOn(paymentModel, 'create')
            .mockRejectedValueOnce(new Error('INJECTED_PAYMENT_FAILURE'));

        try {
            await expect(rideService.createRide(requestData(user, key)))
                .rejects.toThrow('INJECTED_PAYMENT_FAILURE');
        } finally {
            createPayment.mockRestore();
        }

        const freshUser = await userModel.findById(user._id);
        expect(freshUser.walletBalance).toBe(100);
        expect(await rideModel.countDocuments({ user: user._id })).toBe(0);
        expect(await paymentModel.countDocuments({ userId: user._id })).toBe(0);
        expect(await userWalletTransactionModel.countDocuments({ userId: user._id })).toBe(0);
    });
});
