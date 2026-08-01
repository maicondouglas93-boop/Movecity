const PricingEngine = require('../../services/pricingEngine.service');
const TariffSetting = require('../../models/tariffSetting.model');
const VehicleCategory = require('../../models/vehicleCategory.model');
const GlobalSetting = require('../../models/globalSetting.model');
const PricingRule = require('../../models/pricingRule.model');
const Coupon = require('../../models/coupon.model');

describe('Pricing Engine', () => {
    beforeEach(async () => {
        // Setup initial default configs
        await TariffSetting.create({
            minDistanceIncluded: 0,
            minTimeIncluded: 0,
            roundingRule: 'none',
            dynamicPricingStatus: 'off'
        });

        await GlobalSetting.create({
            platformCommission: 20,
            cardFeePercent: 2,
            cardFeeFixed: 0.50
        });

        await VehicleCategory.create({
            name: 'car',
            displayName: 'Carro Econômico',
            isActive: true,
            baseFare: 10,
            perKmRate: 2,
            perMinuteRate: 0.5,
            minFare: 15
        });
    });

    it('should calculate base fare correctly', async () => {
        const result = await PricingEngine.calculateFare({
            distance: 5000, // 5km
            time: 600, // 10 minutes
            vehicleType: 'car',
            paymentMethod: 'cash'
        });

        // 10 + (5 * 2) + (10 * 0.5) = 10 + 10 + 5 = 25
        expect(result.finalFare).toBe(25);
        expect(result.commissionAmount).toBe(5); // 20% of 25
        expect(result.fareBreakdown.driverNetEarnings).toBe(20);
    });

    it('should apply minimum fare rule', async () => {
        const result = await PricingEngine.calculateFare({
            distance: 1000, // 1km
            time: 120, // 2 minutes
            vehicleType: 'car',
            paymentMethod: 'cash'
        });

        // 10 + 2 + 1 = 13 (below 15 minFare) -> 15
        expect(result.finalFare).toBe(15);
    });

    it('should apply card fees correctly', async () => {
        const result = await PricingEngine.calculateFare({
            distance: 5000, // 5km (10)
            time: 600, // 10 min (5)
            vehicleType: 'car',
            paymentMethod: 'card' // base: 25
        });

        // card fee = (25 * 0.02) + 0.50 = 0.50 + 0.50 = 1.00
        // final = 25 + 1 = 26
        // commision base = 25 -> 20% = 5
        expect(result.finalFare).toBe(26);
        expect(result.fareBreakdown.cardFee).toBe(1.00);
        expect(result.commissionAmount).toBe(5);
    });

    it('should apply dynamic pricing multiplier', async () => {
        await TariffSetting.updateOne({}, { dynamicPricingStatus: 'manual', currentMultiplier: 1.5 });

        const result = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash'
        });

        // 25 * 1.5 = 37.5
        expect(result.finalFare).toBe(37.5);
    });

    it('should apply coupons correctly (fixed)', async () => {
        await Coupon.create({
            code: 'TOMA10',
            isActive: true,
            type: 'fixed',
            value: 10,
            expirationDate: new Date('2050-01-01'),
            usageLimit: 100,
            usedCount: 0
        });

        const result = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash',
            couponCode: 'TOMA10'
        });

        // 25 - 10 = 15
        expect(result.finalFare).toBe(15);
        expect(result.fareBreakdown.couponDiscount).toBe(10);
    });

    it('should NOT apply a PricingRule without conditions (regression: "Taxa de Chuva" bug)', async () => {
        await PricingRule.create({
            name: 'Taxa de Chuva',
            type: 'weather',
            modificationType: 'percentage',
            value: 20,
            priority: 1,
            isActive: true
            // sem `conditions` — antes isso era aplicado sempre, incondicionalmente
        });

        const result = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash'
        });

        expect(result.finalFare).toBe(25); // sem +20% de chuva
        expect(result.fareBreakdown.appliedRules).toEqual([]);
    });

    it('should NOT apply a PricingRule with conditions yet (no evaluator implemented)', async () => {
        await PricingRule.create({
            name: 'Horário de Pico',
            type: 'time_based',
            modificationType: 'percentage',
            value: 10,
            priority: 1,
            isActive: true,
            conditions: { startHour: 18, endHour: 20 }
        });

        const result = await PricingEngine.calculateFare({
            distance: 5000,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'cash'
        });

        expect(result.finalFare).toBe(25);
        expect(result.fareBreakdown.appliedRules).toEqual([]);
    });
});
