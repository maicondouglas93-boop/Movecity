// Regressão: cotação não pode ser cacheada com preço stale.
const rideService = require('../../services/ride.service');
const mapService = require('../../services/maps.service');
const TariffSetting = require('../../models/tariffSetting.model');
const GlobalSetting = require('../../models/globalSetting.model');
const VehicleCategory = require('../../models/vehicleCategory.model');

describe('getFare — frescor da tarifa', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    beforeEach(async () => {
        vi.spyOn(mapService, 'getDistanceTime').mockResolvedValue({
            distance: { value: 5000 },
            duration: { value: 600 },
            polyline: 'fake',
        });
        vi.spyOn(mapService, 'getAddressCoordinate').mockResolvedValue({ ltd: -23.55, lng: -46.63 });
        vi.spyOn(mapService, 'getCaptainsInTheRadius').mockResolvedValue([]);

        await TariffSetting.create({
            minDistanceIncluded: 0,
            minTimeIncluded: 0,
            roundingRule: 'none',
            dynamicPricingStatus: 'off',
        });
        await GlobalSetting.create({
            platformCommission: 20,
            cardFeePercent: 0,
            cardFeeFixed: 0,
        });
        await VehicleCategory.create({
            name: 'car',
            displayName: 'Carro',
            isActive: true,
            baseFare: 10,
            perKmRate: 2,
            perMinuteRate: 0,
            minFare: 1,
            pricing: {
                baseFare: 10,
                perKm: 2,
                perMinute: 0,
                minimumFare: 1,
                platformCommission: 20,
                optionals: [
                    { id: 'aceita_animais', name: 'Aceita animais', value: 4, isActive: true },
                ],
            },
        });
    });

    it('reflete imediatamente uma mudança de perKm feita pelo admin', async () => {
        const antes = await rideService.getFare('Origem A', 'Destino B');
        expect(antes.fare.car).toBe(20);

        await VehicleCategory.updateOne(
            { name: 'car' },
            { $set: { perKmRate: 4, 'pricing.perKm': 4 } }
        );

        const depois = await rideService.getFare('Origem A', 'Destino B');
        expect(depois.fare.car).toBe(30);
    });

    it('reflete imediatamente uma mudança de baseFare', async () => {
        const antes = await rideService.getFare('Origem A', 'Destino B');
        await VehicleCategory.updateOne(
            { name: 'car' },
            { $set: { baseFare: 25, 'pricing.baseFare': 25 } }
        );
        const depois = await rideService.getFare('Origem A', 'Destino B');

        expect(depois.fare.car).toBe(antes.fare.car + 15);
    });

    it('reflete imediatamente uma mudança de comissão da categoria', async () => {
        const antes = await rideService.getFare('Origem A', 'Destino B');
        expect(antes.breakdown.car.commissionPercent).toBe(20);

        await VehicleCategory.updateOne(
            { name: 'car' },
            { $set: { 'pricing.platformCommission': 30 } }
        );

        const depois = await rideService.getFare('Origem A', 'Destino B');
        expect(depois.breakdown.car.commissionPercent).toBe(30);
    });

    it('expõe optionalPrices da categoria e não devolve fareMax mockado', async () => {
        const result = await rideService.getFare('Origem A', 'Destino B');
        expect(result.optionalPrices.aceita_animais).toBe(4);
        expect(result.optionalPricesByCategory.car.aceita_animais).toBe(4);
        expect(result.fareMax).toBeUndefined();
        expect(result.fareCardMax).toBeUndefined();
    });
});
