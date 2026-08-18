jest.mock('../../services/maps.service', () => ({
    getDistanceTime: jest.fn(),
    getAddressCoordinate: jest.fn().mockResolvedValue({ ltd: -20.15, lng: -41.62 }),
    haversineKm: jest.fn(() => 1),
    getReverseGeocode: jest.fn(),
}));

jest.mock('../../services/pricingEngine.service', () => ({
    buildConfigSnapshot: jest.fn(),
    calculateFare: jest.fn().mockResolvedValue({
        finalFare: 20,
        commissionAmount: 4,
        commissionPercent: 20,
        fareBreakdown: {},
    }),
}));

const rideService = require('../../services/ride.service');
const mapService = require('../../services/maps.service');
const PricingEngine = require('../../services/pricingEngine.service');

const route = (meters, seconds) => ({
    distance: { value: meters },
    duration: { value: seconds },
});

const LAJINHA = { originLat: -20.1548255, originLng: -41.6291745 };
const params = {
    ...LAJINHA,
    destination: 'Av. Antônio Florêncio Alvim, Lajinha, MG',
    vehicleType: 'car',
    paymentMethod: 'cash',
    serviceKind: 'presential',
    configSnapshot: { category: { pricing: {} } },
};

/**
 * Relato de campo (2026-08-18): corrida presencial dentro de Lajinha estimada em
 * 10.554 km / 21.109 min / R$ 36.946,87. O endereço tinha sido resolvido no lugar
 * errado e o sistema converteu isso em preço, sem nenhuma checagem de sanidade —
 * existia só a validação de distância > 0.
 */
describe('rota implausível não vira preço', () => {
    beforeEach(() => jest.clearAllMocks());

    it('recusa a rota absurda relatada em campo em vez de cobrar por ela', async () => {
        mapService.getDistanceTime.mockResolvedValue(route(10554500, 1266540));

        await expect(rideService.calculateRideFare(params))
            .rejects.toMatchObject({ code: 'IMPLAUSIBLE_ROUTE_DISTANCE' });

        // O preço nem chega a ser calculado: o erro sai antes do motor de tarifa.
        expect(PricingEngine.calculateFare).not.toHaveBeenCalled();
    });

    it('aceita normalmente uma corrida local', async () => {
        mapService.getDistanceTime.mockResolvedValue(route(1200, 300));

        const result = await rideService.calculateRideFare(params);

        expect(result.distance).toBe(1200);
        expect(PricingEngine.calculateFare).toHaveBeenCalled();
    });

    // O teto é detector de erro, não regra de negócio: precisa deixar passar qualquer
    // viagem real, inclusive uma bem longa entre cidades.
    it('aceita viagem longa legítima (500 km)', async () => {
        mapService.getDistanceTime.mockResolvedValue(route(500 * 1000, 6 * 3600));

        const result = await rideService.calculateRideFare(params);

        expect(result.distance).toBe(500 * 1000);
    });

    it('aceita exatamente no limite de 1500 km', async () => {
        mapService.getDistanceTime.mockResolvedValue(route(1500 * 1000, 20 * 3600));

        await expect(rideService.calculateRideFare(params)).resolves.toBeDefined();
    });

    it('recusa logo acima do limite', async () => {
        mapService.getDistanceTime.mockResolvedValue(route(1500 * 1000 + 1, 20 * 3600));

        await expect(rideService.calculateRideFare(params))
            .rejects.toMatchObject({ code: 'IMPLAUSIBLE_ROUTE_DISTANCE' });
    });

    // Distância zero tem código próprio: quase sempre é o ponto de partida detectado
    // em cima do destino (GPS impreciso), não falha do provider. Mandar "tente
    // novamente" nesse caso faz o motorista repetir algo que nunca vai funcionar.
    it('recusa rota sem distância com código próprio', async () => {
        mapService.getDistanceTime.mockResolvedValue(route(0, 0));

        await expect(rideService.calculateRideFare(params))
            .rejects.toMatchObject({ code: 'ZERO_DISTANCE_ROUTE' });
    });

    // Achados L2/L5 da auditoria (2026-08-18): estas verificações viviam só dentro de
    // calculateRideFare, e a corrida comum do passageiro chamava a API de rotas direto.
    // O fluxo MAIS usado era o único sem proteção nenhuma.
    describe('cotação do passageiro (getFare) tem a mesma proteção', () => {
        it('recusa rota absurda em vez de mostrar preço', async () => {
            mapService.getDistanceTime.mockResolvedValue(route(10554500, 1266540));

            await expect(rideService.getFare('Rua A, Lajinha', 'Rua B, Lajinha'))
                .rejects.toMatchObject({ code: 'IMPLAUSIBLE_ROUTE_DISTANCE' });
        });

        it('recusa partida e destino no mesmo ponto', async () => {
            mapService.getDistanceTime.mockResolvedValue(route(0, 0));

            await expect(rideService.getFare('Rua A, Lajinha', 'Rua A, Lajinha'))
                .rejects.toMatchObject({ code: 'ZERO_DISTANCE_ROUTE' });
        });
    });
});
