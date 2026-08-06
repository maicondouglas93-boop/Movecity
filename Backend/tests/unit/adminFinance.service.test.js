const mongoose = require('mongoose');
const adminService = require('../../services/admin.service');
const payoutModel = require('../../models/payout.model');
const transactionModel = require('../../models/transaction.model');
const globalSettingModel = require('../../models/globalSetting.model');
const { createCaptain } = require('../factories/captain.factory');

describe('Admin Service — getPayouts financeiro real', () => {
    beforeEach(async () => {
        await payoutModel.deleteMany({});
        await transactionModel.deleteMany({});
        await globalSettingModel.deleteMany({});
        await globalSettingModel.create({
            platformCommission: 20,
            platformCommissions: { ride: 20, presential: 20, parcel: 20 },
            payoutDeadlineDays: 2,
        });
    });

    it('preenche platformBalance e chartSeries a partir de comissões reais', async () => {
        const captain = await createCaptain();
        await transactionModel.create({
            captainId: captain._id,
            type: 'commission',
            amount: 42.5,
            balanceBefore: 100,
            balanceAfter: 57.5,
            description: 'Comissão teste',
            status: 'completed',
        });
        await payoutModel.create({
            captainId: captain._id,
            amount: 30,
            status: 'requested',
            bankDetailsSnapshot: { pixKey: 'teste@pix.com' },
        });

        const result = await adminService.getPayouts(1, 15, {});

        expect(result.summary.platformBalance).toBe(42.5);
        expect(result.summary.commissionToday).toBe(42.5);
        expect(result.summary.pendingAmount).toBe(30);
        expect(result.payouts).toHaveLength(1);
        expect(result.chartSeries).toHaveLength(7);
        const keyFmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const todayKey = keyFmt.format(new Date());
        expect(result.chartSeries.some((d) => d.date === todayKey)).toBe(true);
        const todayPoint = result.chartSeries.find((d) => d.date === todayKey);
        expect(todayPoint.commission).toBe(42.5);
        expect(todayPoint.valor).toBe(42.5);
    });



    it('busca repasse por nome/chave do motorista', async () => {
        const captain = await createCaptain({
            fullname: { firstname: 'Zuleika', lastname: 'Financeira' },
            pixKey: 'zuleika-chave-unica',
        });
        await payoutModel.create({
            captainId: captain._id,
            amount: 15,
            status: 'requested',
            bankDetailsSnapshot: { pixKey: 'zuleika-chave-unica' },
        });
        await payoutModel.create({
            captainId: new mongoose.Types.ObjectId(),
            amount: 99,
            status: 'requested',
            bankDetailsSnapshot: { pixKey: 'outro' },
        });

        const byName = await adminService.getPayouts(1, 15, { search: 'Zuleika' });
        expect(byName.total).toBe(1);
        expect(byName.payouts[0].amount).toBe(15);

        const byPix = await adminService.getPayouts(1, 15, { search: 'zuleika-chave' });
        expect(byPix.total).toBe(1);
    });
});
