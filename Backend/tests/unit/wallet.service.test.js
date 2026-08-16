const { getWallet, createTransaction, requestPayout } = require('../../services/wallet.service');
const walletModel = require('../../models/wallet.model');
const transactionModel = require('../../models/transaction.model');
const payoutModel = require('../../models/payout.model');
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

    // Plano de correção (Fase 3.1, 2026-08-16, COR-3005): requestPayout fazia
    // check-then-create sem constraint no banco — duas requisições simultâneas do
    // mesmo motorista podiam passar pelo pré-check antes de qualquer payout existir e
    // gerar dois saques pro mesmo saldo. O índice único parcial em payout.model.js
    // (captain_active_payout_unique) é a garantia real; este teste teria falhado antes
    // dele existir.
    describe('requestPayout — concorrência', () => {
        beforeEach(async () => {
            await captainModel.findByIdAndUpdate(captainId, {
                pix: { key: 'motorista@pix.com' },
            });
            await walletModel.create({ captainId, pendingBalance: 200 });
            await globalSettingModel.updateMany({}, { minimumPayout: 50 });
        });

        it('20 chamadas simultâneas resultam em exatamente 1 payout', async () => {
            const attempts = await Promise.allSettled(
                Array.from({ length: 20 }, () => requestPayout(captainId))
            );

            const succeeded = attempts.filter((a) => a.status === 'fulfilled');
            const failed = attempts.filter((a) => a.status === 'rejected');

            expect(succeeded).toHaveLength(1);
            expect(failed).toHaveLength(19);
            failed.forEach((f) => {
                expect(f.reason.message).toBe('Você já tem uma solicitação de saque em andamento');
            });

            const count = await payoutModel.countDocuments({ captainId });
            expect(count).toBe(1);
        });

        it('rejeita uma segunda solicitação depois que a primeira já existe', async () => {
            await requestPayout(captainId);

            await expect(requestPayout(captainId)).rejects.toThrow(
                'Você já tem uma solicitação de saque em andamento'
            );

            const count = await payoutModel.countDocuments({ captainId });
            expect(count).toBe(1);
        });

        it('permite nova solicitação depois que a anterior foi paga', async () => {
            await requestPayout(captainId);
            await payoutModel.updateOne({ captainId }, { status: 'paid' });
            await walletModel.updateOne({ captainId }, { pendingBalance: 200 });

            await expect(requestPayout(captainId)).resolves.toBeDefined();

            const count = await payoutModel.countDocuments({ captainId });
            expect(count).toBe(2);
        });
    });
});
