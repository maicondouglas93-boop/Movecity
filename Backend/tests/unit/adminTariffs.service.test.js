const adminService = require('../../services/admin.service');
const tariffSettingModel = require('../../models/tariffSetting.model');
const globalSettingModel = require('../../models/globalSetting.model');

// Regression coverage for A9: platformCommission/cardFeePercent/cardFeeFixed viviam em
// globalSetting mas o painel só lia/escrevia tariffSetting — o admin não tinha como ver
// ou editar a comissão real (o simulador usava 15% fixo enquanto o real era 20%).
describe('Admin Service — getTariffs / updateGlobalSettings merge', () => {
    beforeEach(async () => {
        await tariffSettingModel.deleteMany({});
        await globalSettingModel.deleteMany({});
    });

    it('should include platformCommission/cardFee fields from globalSetting in getTariffs', async () => {
        await tariffSettingModel.create({ cancellationFee: 5 });
        await globalSettingModel.create({
            platformCommission: 25,
            platformCommissions: { ride: 25, presential: 25, parcel: 25 },
            cardFeePercent: 3,
            cardFeeFixed: 1.5,
        });

        const result = await adminService.getTariffs();

        expect(result.cancellationFee).toBe(5);
        expect(result.platformCommission).toBe(25);
        expect(result.cardFeePercent).toBe(3);
        expect(result.cardFeeFixed).toBe(1.5);
    });

    it('should persist optionalPrices on tariffSetting', async () => {
        await tariffSettingModel.create({ cancellationFee: 5 });
        await globalSettingModel.create({ platformCommission: 20 });

        const result = await adminService.updateGlobalSettings({
            optionalPrices: {
                porta_malas: 2,
                aceita_animais: 4,
                aceita_encomendas: 6,
                adaptado_cadeirante: 0,
                disposicao_passageiro: 20,
            },
        });

        expect(result.optionalPrices.aceita_animais).toBe(4);
        expect(result.optionalPrices.disposicao_passageiro).toBe(20);
        const tariff = await tariffSettingModel.findOne();
        expect(tariff.optionalPrices.aceita_encomendas).toBe(6);
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

    it('getTariffs migra e devolve platformCommissions', async () => {
        await tariffSettingModel.create({});
        // Simula doc legado: só top-level. Nested defaults do schema (20) não podem
        // apagar o legado 18 — ensure reconstrói a partir de platformCommission.
        await globalSettingModel.collection.insertOne({
            platformCommission: 18,
            cardFeePercent: 0,
            cardFeeFixed: 0,
            minFare: 5,
            pricePerKm: 2,
            pricePerMinute: 0.5,
        });

        const result = await adminService.getTariffs();

        expect(result.platformCommission).toBe(18);
        expect(result.platformCommissions).toMatchObject({
            ride: 18,
            presential: 18,
            parcel: 18,
        });
    });

    it('updateGlobalSettings salva comissões por serviço e sincroniza legado com ride', async () => {
        await tariffSettingModel.create({});
        await globalSettingModel.create({ platformCommission: 20 });

        const result = await adminService.updateGlobalSettings({
            platformCommissions: { ride: 12, presential: 8, parcel: 22 },
        });

        expect(result.platformCommission).toBe(12);
        expect(result.platformCommissions).toMatchObject({
            ride: 12,
            presential: 8,
            parcel: 22,
        });

        const gs = await globalSettingModel.findOne();
        expect(gs.platformCommission).toBe(12);
        expect(gs.platformCommissions.ride).toBe(12);
        expect(gs.platformCommissions.presential).toBe(8);
        expect(gs.platformCommissions.parcel).toBe(22);
    });
});
