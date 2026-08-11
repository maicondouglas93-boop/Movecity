// Corrida presencial sem destino: o endereço final descreve somente onde terminou.
// Distância e tempo financeiros sempre representam a corrida inteira.

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

    test('Lajinha->Manhuaçu->Lajinha usa 80km e 150min acumulados, não origem->fim', async () => {
        const ride = buildRide({
            actualDistance: 80000,
            startedAt: new Date(Date.now() - 150 * 60 * 1000),
        });
        rideModel.findOne.mockReturnValue(mockFindOneChain(ride));
        rideModel.findOneAndUpdate.mockResolvedValue({ _id: 'ride1', status: 'finished' });
        require('../../models/captain.model').findById.mockReturnValue({
            select: jest.fn().mockResolvedValue({
                location: { ltd: LAJINHA.lat, lng: LAJINHA.lng },
                lastSeenAt: new Date(),
            }),
        });
        rideModel.findById.mockReturnValue({
            populate: jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue({
                    _id: 'ride1',
                    status: 'finished',
                    pickup: 'Lajinha, Minas Gerais, Brazil',
                    destination: 'Origem, Lajinha',
                    actualDistance: 80000,
                    actualTime: 9000,
                    finalPrice: 250,
                    commissionAmount: 50,
                    fareBreakdown: { driverNetEarnings: 200 },
                }),
            }),
        });

        PricingEngine.calculateFare.mockResolvedValue({
            finalFare: 250,
            commissionAmount: 50,
            commissionPercent: 20,
            driverEarnings: 200,
            fareBreakdown: {
                baseFare: 5,
                distanceFare: 160,
                timeFare: 75,
                finalFare: 250,
                platformCommission: 50,
                driverNetEarnings: 200,
            },
        });

        const result = await rideService.endRide({
            rideId: 'ride1',
            captain: { _id: 'cap1' },
        });

        expect(mapService.getDistanceTime).not.toHaveBeenCalled();
        expect(PricingEngine.calculateFare).toHaveBeenCalledWith(
            expect.objectContaining({
                distance: 80000,
                time: expect.any(Number),
                serviceKind: 'presential',
            }),
        );
        const pricingInput = PricingEngine.calculateFare.mock.calls[0][0];
        expect(pricingInput.time).toBeGreaterThanOrEqual(8999);
        expect(pricingInput.time).toBeLessThanOrEqual(9001);

        const updatePayload = rideModel.findOneAndUpdate.mock.calls[0][1].$set;
        expect(updatePayload.finalPrice).toBe(250);
        expect(updatePayload.actualDistance).toBe(80000);
        expect(updatePayload.actualTime).toBe(pricingInput.time);
        expect(updatePayload.commissionAmount).toBe(50);
        expect(updatePayload.fareBreakdown.driverNetEarnings).toBe(200);
        expect(updatePayload.destination).toBe('Origem, Lajinha');
        expect(updatePayload.destinationPending).toBe(false);
        expect(require('../../models/payment.model').create).toHaveBeenCalledWith(expect.objectContaining({
            rideId: 'ride1',
            amount: 250,
        }));
        // O mesmo documento consumido pelo histórico expõe origem/fim iguais sem perder
        // os 80 km, os 150 minutos nem o resultado financeiro consolidado.
        expect(result).toEqual(expect.objectContaining({
            status: 'finished',
            pickup: 'Lajinha, Minas Gerais, Brazil',
            destination: 'Origem, Lajinha',
            actualDistance: 80000,
            actualTime: 9000,
            finalPrice: 250,
            commissionAmount: 50,
            fareBreakdown: expect.objectContaining({ driverNetEarnings: 200 }),
        }));
    });

    test('não inventa rota origem->fim quando não houve distância GPS suficiente', async () => {
        const ride = buildRide();
        rideModel.findOne.mockReturnValue(mockFindOneChain(ride));

        await expect(rideService.endRide({
            rideId: 'ride1',
            captain: { _id: 'cap1' },
            destination: 'Lajinha, Minas Gerais, Brazil',
        })).rejects.toMatchObject({ code: 'INSUFFICIENT_TRIP_DISTANCE' });

        expect(mapService.getDistanceTime).not.toHaveBeenCalled();
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
