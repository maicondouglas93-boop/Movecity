// Cobre o bug relatado: corrida presencial "Definir destino ao finalizar" caindo
// pra tarifa mínima (R$12,50) em vez de calcular a rota real Lajinha->Ibatiba.
// endRide agora aceita `destination` (texto digitado pelo motorista ao finalizar) e
// usa a mesma função central (calculateRideFare) que "Informar destino agora" usa —
// nunca resolve o preço a partir de um rastro de GPS incompleto/stale.

jest.mock('../../services/maps.service', () => ({
    haversineKm: jest.fn(() => 0),
    getReverseGeocode: jest.fn().mockResolvedValue({ address: 'Origem, Lajinha' }),
    getDistanceTime: jest.fn(),
    getAddressCoordinate: jest.fn(),
}));

jest.mock('../../services/pricingEngine.service', () => ({
    buildConfigSnapshot: jest.fn(),
    calculateFare: jest.fn(),
}));

jest.mock('../../models/captain.model', () => ({
    findById: jest.fn(),
}));

jest.mock('../../models/payment.model', () => ({
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../models/user.model', () => ({}));

jest.mock('../../services/dispatch.service', () => ({
    releaseCaptainBusyLock: jest.fn().mockResolvedValue(undefined),
}));

// Origem real da corrida: Lajinha/ES.
const LAJINHA = { lat: -19.5586, lng: -41.6803 };

function buildRide(overrides = {}) {
    return {
        _id: 'ride1',
        source: 'driver_initiated',
        status: 'started',
        destinationPending: true,
        destination: undefined,
        captain: 'cap1',
        user: null,
        vehicleType: 'car',
        paymentMethod: 'cash',
        pickupCoordinates: { lat: LAJINHA.lat, lng: LAJINHA.lng },
        origin: { coordinates: [ LAJINHA.lng, LAJINHA.lat ] },
        fare: 0,
        finalPrice: 0,
        actualDistance: 0,
        // Rastro de GPS "preso" perto da origem — simula app em segundo plano /
        // poucos pontos de tracking (a causa raiz do bug original).
        lastLocation: { lat: LAJINHA.lat + 0.0002, lng: LAJINHA.lng + 0.0002 },
        startedAt: new Date(Date.now() - 32 * 60 * 1000),
        createdAt: new Date(Date.now() - 33 * 60 * 1000),
        pricingSnapshot: null,
        optionals: [],
        ...overrides,
    };
}

function mockFindOneChain(doc) {
    const chain = { populate: jest.fn(() => chain), select: jest.fn().mockResolvedValue(doc) };
    return chain;
}

jest.mock('../../models/ride.model', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
}));

const rideService = require('../../services/ride.service');
const rideModel = require('../../models/ride.model');
const mapService = require('../../services/maps.service');
const PricingEngine = require('../../services/pricingEngine.service');

describe('endRide — "Definir destino ao finalizar" (destino digitado)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        rideModel.findById.mockReturnValue({
            populate: jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue({ _id: 'ride1', status: 'finished' }),
            }),
        });
    });

    test('calcula a rota real Lajinha->Ibatiba (~22,2km) em vez de cair pra tarifa mínima', async () => {
        const ride = buildRide();
        rideModel.findOne.mockReturnValue(mockFindOneChain(ride));
        rideModel.findOneAndUpdate.mockResolvedValue({ _id: 'ride1', status: 'finished' });

        mapService.getDistanceTime.mockResolvedValue({
            distance: { value: 22200 },
            duration: { value: 1920 },
        });
        mapService.getAddressCoordinate.mockResolvedValue({ ltd: -20.2349, lng: -41.5108 });

        PricingEngine.calculateFare.mockResolvedValue({
            finalFare: 44.74,
            commissionAmount: 8.95,
            commissionPercent: 20,
            fareBreakdown: { baseFare: 5, distanceFare: 39.74 },
        });

        await rideService.endRide({
            rideId: 'ride1',
            captain: { _id: 'cap1' },
            destination: 'Ibatiba, State of Espírito Santo, 29395-000, Brazil',
        });

        // A rota foi calculada Lajinha (origem real) -> Ibatiba (destino digitado),
        // nunca a partir do GPS "preso" perto da origem.
        expect(mapService.getDistanceTime).toHaveBeenCalledWith(
            `${LAJINHA.lat},${LAJINHA.lng}`,
            'Ibatiba, State of Espírito Santo, 29395-000, Brazil',
        );

        // PricingEngine recebeu a distância REAL da rota (22200m), não os ~30m do
        // GPS parado perto da origem — essa era a causa da tarifa mínima (R$12,50).
        expect(PricingEngine.calculateFare).toHaveBeenCalledWith(
            expect.objectContaining({ distance: 22200 }),
        );

        const updatePayload = rideModel.findOneAndUpdate.mock.calls[0][1].$set;
        expect(updatePayload.finalPrice).toBe(44.74);
        expect(updatePayload.actualDistance).toBe(22200);
        expect(updatePayload.destination).toBe('Ibatiba, State of Espírito Santo, 29395-000, Brazil');
        expect(updatePayload.destinationPending).toBe(false);
    });

    test('nunca mascara falha de rota com tarifa mínima — propaga ROUTE_CALCULATION_FAILED', async () => {
        const ride = buildRide();
        rideModel.findOne.mockReturnValue(mockFindOneChain(ride));

        mapService.getDistanceTime.mockRejectedValue(new Error('Unable to resolve coordinates'));

        await expect(rideService.endRide({
            rideId: 'ride1',
            captain: { _id: 'cap1' },
            destination: 'Endereço inexistente 12345',
        })).rejects.toMatchObject({ code: 'ROUTE_CALCULATION_FAILED' });

        expect(PricingEngine.calculateFare).not.toHaveBeenCalled();
        expect(rideModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('sem destino digitado, mantém o fluxo legado baseado em GPS (compatibilidade)', async () => {
        const ride = buildRide();
        rideModel.findOne.mockReturnValue(mockFindOneChain(ride));
        rideModel.findOneAndUpdate.mockResolvedValue({ _id: 'ride1', status: 'finished' });
        require('../../models/captain.model').findById.mockReturnValue({
            select: jest.fn().mockResolvedValue({
                location: { ltd: LAJINHA.lat + 0.0002, lng: LAJINHA.lng + 0.0002 },
                lastSeenAt: new Date(),
            }),
        });
        mapService.haversineKm.mockReturnValue(0.03); // ~30m — abaixo do limiar de 50m
        // Sem tracking acumulado e quase parado na origem: deve rejeitar (comportamento
        // legado já existente) em vez de inventar destino/preço.
        await expect(rideService.endRide({
            rideId: 'ride1',
            captain: { _id: 'cap1' },
        })).rejects.toMatchObject({ code: 'INSUFFICIENT_TRIP_DISTANCE' });
    });
});
