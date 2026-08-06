// Regressão da auditoria de integração (2026-08-06): a cotação era cacheada por 30
// minutos e nenhum caminho que altera tarifa invalidava a chave. O passageiro via um
// preço e createRide cobrava outro. Este teste falha se o cache voltar.
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
        // Rota fixa: o teste é sobre tarifa, não sobre distância real.
        vi.spyOn(mapService, 'getDistanceTime').mockResolvedValue({
            distance: { value: 5000 },
            duration: { value: 600 },
            polyline: 'fake',
        });
        // ETA consulta motoristas próximos — irrelevante pra frescor de tarifa.
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
        });
    });

    it('reflete imediatamente uma mudança de perKmRate feita pelo admin', async () => {
        const antes = await rideService.getFare('Origem A', 'Destino B');
        // 10 base + 5km * 2 = 20
        expect(antes.fare.car).toBe(20);

        await VehicleCategory.updateOne({ name: 'car' }, { $set: { perKmRate: 4 } });

        // Mesma origem/destino: antes o cache devolveria 20 por até 30 minutos.
        const depois = await rideService.getFare('Origem A', 'Destino B');
        // 10 base + 5km * 4 = 30
        expect(depois.fare.car).toBe(30);
    });

    it('reflete imediatamente uma mudança de baseFare', async () => {
        const antes = await rideService.getFare('Origem A', 'Destino B');
        await VehicleCategory.updateOne({ name: 'car' }, { $set: { baseFare: 25 } });
        const depois = await rideService.getFare('Origem A', 'Destino B');

        expect(depois.fare.car).toBe(antes.fare.car + 15);
    });

    it('reflete imediatamente uma mudança de comissão da plataforma', async () => {
        const antes = await rideService.getFare('Origem A', 'Destino B');
        expect(antes.breakdown.car.commissionPercent).toBe(20);

        await GlobalSetting.updateOne({}, { $set: { platformCommission: 30, 'platformCommissions.ride': 30 } });

        const depois = await rideService.getFare('Origem A', 'Destino B');
        expect(depois.breakdown.car.commissionPercent).toBe(30);
    });

    it('expõe optionalPrices vigentes e não devolve fareMax mockado', async () => {
        await TariffSetting.updateOne({}, {
            $set: {
                optionalPrices: {
                    porta_malas: 0,
                    aceita_animais: 4,
                    aceita_encomendas: 5,
                    adaptado_cadeirante: 0,
                    disposicao_passageiro: 15,
                },
            },
        });
        const result = await rideService.getFare('Origem A', 'Destino B');
        expect(result.optionalPrices.aceita_animais).toBe(4);
        expect(result.fareMax).toBeUndefined();
        expect(result.fareCardMax).toBeUndefined();
    });
});
