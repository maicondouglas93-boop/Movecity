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
        category: { name: 'car' },
        tariffSetting: {},
        rules: [],
    }),
    calculateFare: jest.fn().mockResolvedValue({
        finalFare: 20,
        commissionAmount: 4,
        fareBreakdown: { platformCommission: 4, baseFare: 5 },
    }),
}));

const mongoose = require('mongoose');
const rideService = require('../../services/ride.service');
const rideModel = require('../../models/ride.model');
const paymentModel = require('../../models/payment.model');
const promotionModel = require('../../models/promotion.model');
const promotionUsageModel = require('../../models/promotionUsage.model');
const userModel = require('../../models/user.model');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');

async function createPromo(code = 'AGENDA10') {
    return promotionModel.create({
        type: 'coupon',
        code,
        title: 'Cupom agenda',
        discountType: 'fixed',
        value: 5,
        startDate: new Date(Date.now() - 86400000),
        endDate: new Date(Date.now() + 7 * 86400000),
        status: 'active',
        usagePerUserLimit: 10,
    });
}

describe('Fase 4 — financeiro do agendamento', () => {
    beforeEach(async () => {
        await rideModel.deleteMany({});
        await paymentModel.deleteMany({});
        await promotionModel.deleteMany({});
        await promotionUsageModel.deleteMany({});
    });

    it('create scheduled com useWalletBalance:true NÃO debita carteira', async () => {
        const user = await createUser({
            email: `wal_${Date.now()}@test.com`,
            walletBalance: 100,
        });

        const { ride } = await rideService.createRide({
            user: user._id,
            pickup: 'Rua A, Centro',
            destination: 'Rua B, Centro',
            vehicleType: 'car',
            paymentMethod: 'pix',
            useWalletBalance: true,
            scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });

        expect(ride.status).toBe('scheduled');
        expect(ride.useWalletScheduled).toBe(true);
        expect(ride.walletAmountUsed).toBe(0);

        const fresh = await userModel.findById(user._id);
        expect(fresh.walletBalance).toBe(100);

        const payments = await paymentModel.find({ rideId: ride._id });
        expect(payments).toHaveLength(0);
    });

    it('create scheduled com cupom congela desconto mas NÃO recordPromotionUsage', async () => {
        const user = await createUser({ email: `prm_${Date.now()}@test.com` });
        await createPromo('MOVE5');

        const { ride } = await rideService.createRide({
            user: user._id,
            pickup: 'Rua A, Centro',
            destination: 'Rua B, Centro',
            vehicleType: 'car',
            paymentMethod: 'cash',
            promoCode: 'MOVE5',
            scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });

        expect(ride.promoCodeScheduled).toBe('MOVE5');
        expect(ride.discountAmount).toBe(5);
        expect(ride.finalPrice).toBe(15);
        expect(await promotionUsageModel.countDocuments({ rideId: ride._id })).toBe(0);
    });

    it('settleScheduledRideFinance debita wallet, cria payment e registra cupom (idempotente)', async () => {
        const user = await createUser({
            email: `set_${Date.now()}@test.com`,
            walletBalance: 50,
        });
        const promo = await createPromo('SET5');

        const ride = await rideModel.create({
            user: user._id,
            pickup: 'Rua A',
            destination: 'Rua B',
            fare: 20,
            finalPrice: 15,
            vehicleType: 'car',
            otp: '123456',
            status: 'requested',
            scheduledAt: new Date(),
            activatedAt: new Date(),
            promoCodeScheduled: 'SET5',
            promotionApplied: promo._id,
            discountAmount: 5,
            useWalletScheduled: true,
            walletAmountUsed: 0,
            paymentMethod: 'pix',
            commissionAmount: 4,
            commissionPercent: 20,
            source: 'passenger_requested',
        });

        const settled = await rideService.settleScheduledRideFinance(ride._id);
        expect(settled.scheduleFinanceSettledAt).toBeTruthy();
        expect(settled.walletAmountUsed).toBe(15);
        expect(settled.paymentMethod).toBe('carteira');

        const freshUser = await userModel.findById(user._id);
        expect(freshUser.walletBalance).toBe(35);

        expect(await promotionUsageModel.countDocuments({ rideId: ride._id })).toBe(1);
        expect(await paymentModel.countDocuments({ rideId: ride._id })).toBe(1);

        const again = await rideService.settleScheduledRideFinance(ride._id);
        expect(again).toBeNull();
        expect(await promotionUsageModel.countDocuments({ rideId: ride._id })).toBe(1);
        const user2 = await userModel.findById(user._id);
        expect(user2.walletBalance).toBe(35);
    });

    it('cancelRide de scheduled não cobra taxa', async () => {
        const user = await createUser({ email: `can_${Date.now()}@test.com` });
        const ride = await rideModel.create({
            user: user._id,
            pickup: 'Rua A',
            destination: 'Rua B',
            fare: 20,
            vehicleType: 'car',
            otp: '999999',
            status: 'scheduled',
            scheduledAt: new Date(Date.now() + 3600000),
            source: 'passenger_requested',
        });

        const cancelled = await rideService.cancelRide({
            rideId: ride._id,
            user: user._id,
            reason: 'desisti',
        });
        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.cancellationFeeCharged || 0).toBe(0);
    });

    it('confirmPaymentReceived após corrida originada de schedule é idempotente na comissão', async () => {
        const user = await createUser({ email: `fin_${Date.now()}@test.com` });
        const captain = await createCaptain({
            email: `capf_${Date.now()}@test.com`,
            approvalStatus: 'aprovado',
        });

        const walletModel = require('../../models/wallet.model');
        await walletModel.create({
            captainId: captain._id,
            creditBalance: 100,
            pendingBalance: 0,
            totalEarned: 0,
            totalCommissionPaid: 0,
        });

        const ride = await rideModel.create({
            user: user._id,
            captain: captain._id,
            pickup: 'Rua A',
            destination: 'Rua B',
            fare: 20,
            finalPrice: 20,
            vehicleType: 'car',
            otp: '555555',
            status: 'finished',
            scheduledAt: new Date(Date.now() - 3600000),
            activatedAt: new Date(Date.now() - 3000000),
            scheduleFinanceSettledAt: new Date(Date.now() - 3000000),
            paymentMethod: 'cash',
            paymentStatus: 'pending',
            commissionAmount: 4,
            commissionPercent: 20,
            source: 'passenger_requested',
        });

        await paymentModel.create({
            rideId: ride._id,
            userId: user._id,
            amount: 20,
            method: 'cash',
            status: 'pending',
        });

        await rideService.confirmPaymentReceived({ rideId: ride._id, captain });
        await expect(
            rideService.confirmPaymentReceived({ rideId: ride._id, captain })
        ).rejects.toThrow(/already confirmed|já/i);

        const transactionModel = require('../../models/transaction.model');
        const commissions = await transactionModel.find({
            rideId: ride._id,
            type: 'commission',
        });
        expect(commissions).toHaveLength(1);
        expect(commissions[0].amount).toBe(4);
    });
});
