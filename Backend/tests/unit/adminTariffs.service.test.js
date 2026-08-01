const adminService = require('../../services/admin.service');
const tariffSettingModel = require('../../models/tariffSetting.model');
const globalSettingModel = require('../../models/globalSetting.model');

// Regression coverage for A9: platformCommission/cardFeePercent/cardFeeFixed viviam em
// globalSetting mas o painel só lia/escrevia tariffSetting — o admin não tinha como ver
// ou editar a comissão real (o simulador usava 15% fixo enquanto o real era 20%).
describe('Admin Service — getTariffs / updateGlobalSettings merge', () => {
    it('should include platformCommission/cardFee fields from globalSetting in getTariffs', async () => {
        await tariffSettingModel.create({ cancellationFee: 5 });
        await globalSettingModel.create({ platformCommission: 25, cardFeePercent: 3, cardFeeFixed: 1.5 });

        const result = await adminService.getTariffs();

        expect(result.cancellationFee).toBe(5);
        expect(result.platformCommission).toBe(25);
        expect(result.cardFeePercent).toBe(3);
        expect(result.cardFeeFixed).toBe(1.5);
    });

    it('should persist platformCommission to globalSetting, not tariffSetting', async () => {
        await tariffSettingModel.create({ cancellationFee: 5 });
        await globalSettingModel.create({ platformCommission: 20 });

        await adminService.updateGlobalSettings({ cancellationFee: 8, platformCommission: 30 });

        const tariff = await tariffSettingModel.findOne();
        expect(tariff.cancellationFee).toBe(8);
        expect(tariff.platformCommission).toBeUndefined();

        const globalSetting = await globalSettingModel.findOne();
        expect(globalSetting.platformCommission).toBe(30);
    });

    it('should return the merged, updated values', async () => {
        await tariffSettingModel.create({});
        await globalSettingModel.create({ platformCommission: 20 });

        const result = await adminService.updateGlobalSettings({ platformCommission: 22, cardFeePercent: 2.5 });

        expect(result.platformCommission).toBe(22);
        expect(result.cardFeePercent).toBe(2.5);
    });
});
