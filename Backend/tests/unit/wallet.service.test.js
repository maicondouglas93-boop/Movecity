const { getWallet, createTransaction } = require('../../services/wallet.service');
const walletModel = require('../../models/wallet.model');
const transactionModel = require('../../models/transaction.model');
const captainModel = require('../../models/captain.model');
const globalSettingModel = require('../../models/globalSetting.model');
const mongoose = require('mongoose');

describe('Wallet Service', () => {
    let captainId;

    beforeEach(async () => {
        captainId = new mongoose.Types.ObjectId();
        await captainModel.create({
            _id: captainId,
            fullname: { firstname: 'Test', lastname: 'Driver' },
            email: 'driver@test.com',
            phone: '+5511999999999',
            password: 'password123',
            vehicle: { color: 'black', plate: 'TEST1234', capacity: 4, vehicleType: 'car' }
        });

        await globalSettingModel.create({
            platformCommission: 20,
            blockDriverOnNegativeBalance: true,
            maximumNegativeBalance: -50
        });
    });

    describe('getWallet', () => {
        it('should create a new wallet if it does not exist', async () => {
            const wallet = await getWallet(captainId);
            expect(wallet).toBeDefined();
            expect(wallet.captainId.toString()).toEqual(captainId.toString());
            expect(wallet.creditBalance).toBe(0);
        });

        it('should return existing wallet if it exists', async () => {
            await walletModel.create({ captainId, creditBalance: 100 });
            const wallet = await getWallet(captainId);
            expect(wallet.creditBalance).toBe(100);
        });
    });

    describe('createTransaction', () => {
        it('should add to creditBalance for a recharge', async () => {
            const result = await createTransaction({
                captainId,
                type: 'recharge',
                paymentMethod: 'pix',
                amount: 50,
                description: 'Pix Recharge'
            });

            expect(result.wallet.creditBalance).toBe(50);
            expect(result.transaction.amount).toBe(50);
            expect(result.transaction.balanceBefore).toBe(0);
            expect(result.transaction.balanceAfter).toBe(50);
        });

        it('should subtract from creditBalance for a commission', async () => {
            await walletModel.create({ captainId, creditBalance: 100 });
            const result = await createTransaction({
                captainId,
                type: 'commission',
                paymentMethod: 'wallet',
                amount: 20,
                description: 'Ride Commission'
            });

            expect(result.wallet.creditBalance).toBe(80);
            expect(result.wallet.totalCommissionPaid).toBe(20);
            expect(result.transaction.balanceAfter).toBe(80);
            expect(result.transaction.rideId).toBeUndefined();
        });

        it('múltiplas comissões sem rideId não geram E11000 duplicate key', async () => {
            await mongoose.model('transaction').syncIndexes();
            await walletModel.create({ captainId, creditBalance: 100 });

            await createTransaction({
                captainId,
                type: 'commission',
                paymentMethod: 'wallet',
                amount: 10,
                description: 'Commission A',
            });
            await expect(createTransaction({
                captainId,
                type: 'commission',
                paymentMethod: 'wallet',
                amount: 15,
                description: 'Commission B',
            })).resolves.toBeDefined();

            const commissions = await transactionModel.find({ captainId, type: 'commission' });
            expect(commissions).toHaveLength(2);
            expect(commissions.every((t) => t.rideId == null)).toBe(true);
        });

        it('should add to pendingBalance and totalEarned for card ride_payment', async () => {
            const result = await createTransaction({
                captainId,
                type: 'ride_payment',
                paymentMethod: 'card',
                amount: 30,
                description: 'Card Payment'
            });

            expect(result.wallet.pendingBalance).toBe(30);
            expect(result.wallet.totalEarned).toBe(30);
            expect(result.wallet.creditBalance).toBe(0); // Should not affect creditBalance
        });

        it('should block driver if creditBalance falls below maximumNegativeBalance', async () => {
            const result = await createTransaction({
                captainId,
                type: 'commission',
                paymentMethod: 'wallet',
                amount: 60, // 0 - 60 = -60 (below -50)
                description: 'Ride Commission'
            });

            expect(result.wallet.creditBalance).toBe(-60);

            const captain = await captainModel.findById(captainId);
            expect(captain.canReceiveRides).toBe(false);
        });

        it('should unblock driver if balance is restored', async () => {
            await captainModel.findByIdAndUpdate(captainId, { canReceiveRides: false });
            await walletModel.create({ captainId, creditBalance: -60 });

            await createTransaction({
                captainId,
                type: 'recharge',
                paymentMethod: 'pix',
                amount: 100, // -60 + 100 = 40
                description: 'Recharge'
            });

            const captain = await captainModel.findById(captainId);
            expect(captain.canReceiveRides).toBe(true);
        });
    });
});
