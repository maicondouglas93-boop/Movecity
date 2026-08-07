const PricingEngine = require('../../services/pricingEngine.service');
const VehicleCategory = require('../../models/vehicleCategory.model');
const GlobalSetting = require('../../models/globalSetting.model');
const Coupon = require('../../models/coupon.model');
const GlobalTariff = require('../../models/globalTariff.model');

async function seedCategory(overrides = {}) {
    const pricing = {
        baseFare: 10,
        perKm: 2,
        perMinute: 0.5,
        minimumFare: 15,
        platformCommission: 20,
        parcelAdjustment: { isActive: false, type: 'percentage', value: 0 },
        optionals: [],
        ...(overrides.pricing || {}),
    };
    return VehicleCategory.create({
        name: 'car',
        displayName: 'Carro Econômico',
        isActive: true,
        baseFare: pricing.baseFare,
        perKmRate: pricing.perKm,
        perMinuteRate: pricing.perMinute,
        minFare: pricing.minimumFare,
        ...overrides,
        pricing,
    });
}

describe('Pricing Engine', () => {
    beforeEach(async () => {
        await GlobalSetting.create({
            platformCommission: 20,
            cardFeePercent: 2,
            cardFeeFixed: 0.50,
        });
        await seedCategory();
    });

    it('calcula tarifa base corretamente', async () => {
        const result = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
        });

        // 10 + (5 * 2) + (10 * 0.5) = 25
        expect(result.finalFare).toBe(25);
        expect(result.commissionAmount).toBe(5);
        expect(result.fareBreakdown.driverNetEarnings).toBe(20);
    });

    it('aplica tarifa mínima', async () => {
        const result = await PricingEngine.calculateFare({
            distance: 1000,
            time: 120,
            vehicleType: 'car',
            paymentMethod: 'cash',
        });

        expect(result.finalFare).toBe(15);
    });

    it('aplica taxa de cartão', async () => {
        const result = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'card',
        });

        // card fee = (25 * 0.02) + 0.50 = 1.00 → final 26; comissão sobre 25
        expect(result.finalFare).toBe(26);
        expect(result.fareBreakdown.cardFee).toBe(1);
        expect(result.commissionAmount).toBe(5);
    });

    it('aplica cupom fixo', async () => {
        await Coupon.create({
            code: 'TOMA10',
            isActive: true,
            type: 'fixed',
            value: 10,
            expirationDate: new Date('2050-01-01'),
            usageLimit: 100,
            usedCount: 0,
        });

        const result = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
            couponCode: 'TOMA10',
        });

        expect(result.finalFare).toBe(15);
        expect(result.fareBreakdown.discounts.coupon).toBe(10);
    });

    it('usa comissão única da categoria (igual em ride e presential)', async () => {
        await VehicleCategory.updateOne(
            { name: 'car' },
            { $set: { 'pricing.platformCommission': 15 } }
        );

        const ride = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
            serviceKind: 'ride',
        });
        const presential = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
            serviceKind: 'presential',
        });

        expect(ride.finalFare).toBe(25);
        expect(presential.finalFare).toBe(25);
        expect(ride.commissionPercent).toBe(15);
        expect(presential.commissionPercent).toBe(15);
        expect(ride.commissionAmount).toBe(3.75);
        expect(presential.commissionAmount).toBe(3.75);
        expect(ride.fareBreakdown.serviceKind).toBe('ride');
        expect(presential.fareBreakdown.serviceKind).toBe('presential');
        expect(ride.fareBreakdown.surcharges.parcelAdjustment).toBe(0);
        expect(presential.fareBreakdown.surcharges.parcelAdjustment).toBe(0);
    });

    it('aplica parcelAdjustment percentual só em serviceKind=parcel', async () => {
        await VehicleCategory.updateOne(
            { name: 'car' },
            {
                $set: {
                    'pricing.parcelAdjustment': { isActive: true, type: 'percentage', value: 10 },
                },
            }
        );

        const ride = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
            serviceKind: 'ride',
        });
        const parcel = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
            serviceKind: 'parcel',
        });

        expect(ride.finalFare).toBe(25);
        expect(ride.fareBreakdown.surcharges.parcelAdjustment).toBe(0);
        // 25 + 10% = 27.5
        expect(parcel.finalFare).toBe(27.5);
        expect(parcel.fareBreakdown.surcharges.parcelAdjustment).toBe(2.5);
    });

    it('aplica parcelAdjustment fixo e ignora quando desligado', async () => {
        await VehicleCategory.updateOne(
            { name: 'car' },
            {
                $set: {
                    'pricing.parcelAdjustment': { isActive: true, type: 'fixed', value: 5 },
                },
            }
        );

        const on = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
            serviceKind: 'parcel',
        });
        expect(on.finalFare).toBe(30);
        expect(on.fareBreakdown.surcharges.parcelAdjustment).toBe(5);

        await VehicleCategory.updateOne(
            { name: 'car' },
            { $set: { 'pricing.parcelAdjustment.isActive': false } }
        );

        const off = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
            serviceKind: 'parcel',
        });
        expect(off.finalFare).toBe(25);
        expect(off.fareBreakdown.surcharges.parcelAdjustment).toBe(0);
    });

    it('isola tarifas entre categorias (carro vs moto)', async () => {
        await VehicleCategory.create({
            name: 'moto',
            displayName: 'Moto',
            isActive: true,
            baseFare: 5,
            perKmRate: 1,
            perMinuteRate: 0.2,
            minFare: 5,
            pricing: {
                baseFare: 5,
                perKm: 1,
                perMinute: 0.2,
                minimumFare: 5,
                platformCommission: 20,
                parcelAdjustment: { isActive: false, type: 'percentage', value: 0 },
            },
        });

        const car = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
        });
        const moto = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'moto',
            paymentMethod: 'cash',
        });

        // car 25; moto: 5 + 5*1 + 10*0.2 = 12
        expect(car.finalFare).toBe(25);
        expect(moto.finalFare).toBe(12);
    });

    it('congela parcelAdjustment e comissão no snapshot', async () => {
        await VehicleCategory.updateOne(
            { name: 'car' },
            {
                $set: {
                    'pricing.platformCommission': 10,
                    'pricing.parcelAdjustment': { isActive: true, type: 'fixed', value: 4 },
                },
            }
        );

        const snapshot = await PricingEngine.buildConfigSnapshot({
            vehicleType: 'car',
            serviceKind: 'parcel',
        });
        expect(snapshot.serviceKind).toBe('parcel');
        expect(snapshot.parcelAdjustment).toEqual({
            isActive: true,
            type: 'fixed',
            value: 4,
        });

        // Mudança live não afeta cálculo com snapshot
        await VehicleCategory.updateOne(
            { name: 'car' },
            {
                $set: {
                    'pricing.platformCommission': 50,
                    'pricing.parcelAdjustment': { isActive: true, type: 'fixed', value: 99 },
                    'pricing.baseFare': 100,
                },
            }
        );

        const priced = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
            configSnapshot: snapshot,
            serviceKind: 'parcel',
        });

        // snapshot ainda tem base 10 → 25 + 4 = 29; comissão 10%
        expect(priced.finalFare).toBe(29);
        expect(priced.commissionPercent).toBe(10);
        expect(priced.fareBreakdown.surcharges.parcelAdjustment).toBe(4);
    });

    it('soma tarifas globais ativas no total (várias ao mesmo tempo)', async () => {
        await GlobalTariff.create([
            { name: 'Taxa de embarque', value: 2, active: true },
            { name: 'Taxa noturna', value: 3, active: true },
            { name: 'Inativa', value: 50, active: false },
        ]);

        const result = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
        });

        // base 25 + 2 + 3 = 30 (inativa ignorada)
        expect(result.finalFare).toBe(30);
        expect(result.fareBreakdown.surcharges.globalTariffs).toBe(5);
        expect(result.fareBreakdown.globalTariffsApplied).toHaveLength(2);
    });

    it('aplica a mesma tarifa global em carro e moto', async () => {
        await GlobalTariff.create({ name: 'Embarque', value: 2, active: true });
        await VehicleCategory.create({
            name: 'moto',
            displayName: 'Moto',
            isActive: true,
            baseFare: 5,
            perKmRate: 1,
            perMinuteRate: 0.2,
            minFare: 5,
            pricing: {
                baseFare: 5,
                perKm: 1,
                perMinute: 0.2,
                minimumFare: 5,
                platformCommission: 20,
            },
        });

        const car = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
        });
        const moto = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'moto',
            paymentMethod: 'cash',
        });

        // car 25+2=27; moto 12+2=14
        expect(car.finalFare).toBe(27);
        expect(moto.finalFare).toBe(14);
        expect(car.fareBreakdown.surcharges.globalTariffs).toBe(2);
        expect(moto.fareBreakdown.surcharges.globalTariffs).toBe(2);
    });

    it('desativar ou excluir remove impacto no cálculo', async () => {
        const t = await GlobalTariff.create({ name: 'Embarque', value: 2, active: true });
        let priced = await PricingEngine.calculateFare({
            distance: 5000, time: 600, vehicleType: 'car', paymentMethod: 'cash',
        });
        expect(priced.finalFare).toBe(27);

        await GlobalTariff.updateOne({ _id: t._id }, { $set: { active: false } });
        priced = await PricingEngine.calculateFare({
            distance: 5000, time: 600, vehicleType: 'car', paymentMethod: 'cash',
        });
        expect(priced.finalFare).toBe(25);

        await GlobalTariff.updateOne({ _id: t._id }, { $set: { active: true } });
        await GlobalTariff.deleteOne({ _id: t._id });
        priced = await PricingEngine.calculateFare({
            distance: 5000, time: 600, vehicleType: 'car', paymentMethod: 'cash',
        });
        expect(priced.finalFare).toBe(25);
        expect(priced.fareBreakdown.surcharges.globalTariffs).toBe(0);
    });

    it('congela tarifas globais no snapshot', async () => {
        await GlobalTariff.create({ name: 'Embarque', value: 2, active: true });
        const snapshot = await PricingEngine.buildConfigSnapshot({
            vehicleType: 'car',
            serviceKind: 'ride',
        });
        expect(snapshot.globalTariffs).toHaveLength(1);
        expect(snapshot.globalTariffs[0].value).toBe(2);

        await GlobalTariff.deleteMany({});
        await GlobalTariff.create({ name: 'Nova', value: 99, active: true });

        const priced = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
            configSnapshot: snapshot,
        });
        // snapshot ainda tem +2, não +99
        expect(priced.finalFare).toBe(27);
        expect(priced.fareBreakdown.surcharges.globalTariffs).toBe(2);
    });
});
