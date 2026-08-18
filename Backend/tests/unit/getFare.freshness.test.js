// Regressão: cotação não pode ser cacheada com preço stale.
//
// Auditoria de cache (2026-08-08, A3): buildConfigSnapshot passou a ler VehicleCategory
// por um cache de 600s. Numa mudança feita pelo painel admin de verdade
// (adminService.updateVehicleCategory), isso continua "imediato" — a própria função
// invalida o cache antes de devolver. Este teste escreve direto no model (bypassa o
// admin.service.js de propósito, pra isolar só a lógica de tarifa) — sem chamar a
// mesma invalidação que uma edição real dispararia, o teste não reproduziria uma
// mudança de admin de verdade. `invalidateVehicleCategoryCache()` depois de cada
// update deixa o teste fiel ao que uma edição real do painel causa.
const rideService = require('../../services/ride.service');
const mapService = require('../../services/maps.service');
const TariffSetting = require('../../models/tariffSetting.model');
const GlobalSetting = require('../../models/globalSetting.model');
const VehicleCategory = require('../../models/vehicleCategory.model');
const { invalidateVehicleCategoryCache } = require('../../services/vehicleCategoryCache.service');

describe('getFare — frescor da tarifa', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    beforeEach(async () => {
        jest.spyOn(mapService, 'getDistanceTime').mockResolvedValue({
            distance: { value: 5000 },
            duration: { value: 600 },
            polyline: 'fake',
        });
        jest.spyOn(mapService, 'getAddressCoordinate').mockResolvedValue({ ltd: -23.55, lng: -46.63 });
        jest.spyOn(mapService, 'getCaptainsInTheRadius').mockResolvedValue([]);

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
        invalidateVehicleCategoryCache();

        const depois = await rideService.getFare('Origem A', 'Destino B');
        expect(depois.fare.car).toBe(30);
    });

    it('reflete imediatamente uma mudança de baseFare', async () => {
        const antes = await rideService.getFare('Origem A', 'Destino B');
        await VehicleCategory.updateOne(
            { name: 'car' },
            { $set: { baseFare: 25, 'pricing.baseFare': 25 } }
        );
        invalidateVehicleCategoryCache();
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
        invalidateVehicleCategoryCache();

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

    // Regressão do 500 em produção (2026-08-18): ao unificar o cálculo de rota em
    // resolveRouteForPricing, a variável `distanceTime` sumiu mas a montagem da resposta
    // continuou lendo `distanceTime.polyline` — ReferenceError em TODA cotação do
    // passageiro, que o controller traduzia no 500 genérico. Este arquivo cobria o
    // caminho inteiro, mas estava escrito em sintaxe do vitest (`vi.spyOn`) rodando sob
    // jest: as 4 asserções morriam em "vi is not defined" antes de exercitar qualquer
    // coisa. O teste existia e mesmo assim o bug chegou na loja — por isso a cotação
    // agora afirma o corpo da resposta, e não só o preço.
    it('devolve a resposta completa da cotação, com polyline da rota', async () => {
        const result = await rideService.getFare('Origem A', 'Destino B');

        expect(result.polyline).toBe('fake');
        expect(result.distance).toBe(5000);
        expect(result.time).toBe(600);
    });
});
