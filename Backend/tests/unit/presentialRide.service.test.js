jest.mock('../../services/maps.service', () => ({
    haversineKm: jest.fn((aLat, aLng, bLat, bLng) => {
        const toRad = (v) => (v * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(bLat - aLat);
        const dLng = toRad(bLng - aLng);
        const s = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    }),
    getReverseGeocode: jest.fn().mockResolvedValue({ address: 'Rua Origem, 100' }),
    getDistanceTime: jest.fn().mockResolvedValue({
        distance: { value: 5200 },
        duration: { value: 900 },
    }),
    getAddressCoordinate: jest.fn().mockResolvedValue({ ltd: -20.16, lng: -41.63 }),
}));

jest.mock('../../services/pricingEngine.service', () => ({
    buildConfigSnapshot: jest.fn().mockResolvedValue({
        globalSetting: { platformCommission: 20 },
        category: { name: 'car' },
        tariffSetting: {},
        rules: [],
    }),
    calculateFare: jest.fn().mockResolvedValue({
        finalFare: 18.5,
        commissionAmount: 3.7,
        fareBreakdown: { platformCommission: 3.7, baseFare: 5 },
    }),
}));

jest.mock('../../services/dispatch.service', () => ({
    ACTIVE_PARCEL_STATUSES: [ 'accepted', 'picking_up', 'in_transit' ],
    acquireCaptainBusyLock: jest.fn().mockResolvedValue(true),
    releaseCaptainBusyLock: jest.fn().mockResolvedValue(undefined),
    releaseCaptainBusyLockIfIdle: jest.fn().mockResolvedValue(true),
    isVehicleCategoryAllowed: jest.fn().mockResolvedValue(true),
    captainHasActiveParcel: jest.fn().mockResolvedValue(false),
}));

const mockCaptainDoc = {
    _id: 'cap1',
    approvalStatus: 'aprovado',
    isBlocked: false,
    canReceiveRides: true,
    vehicle: { vehicleType: 'car' },
    location: { ltd: -20.15, lng: -41.62 },
};

jest.mock('../../models/captain.model', () => ({
    findById: jest.fn().mockResolvedValue(mockCaptainDoc),
    findByIdAndUpdate: jest.fn().mockResolvedValue(mockCaptainDoc),
}));

jest.mock('../../models/user.model', () => ({
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
}));

jest.mock('../../models/parcel.model', () => ({
    exists: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../models/payment.model', () => ({
    create: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
}));

// O cancelamento presencial delega a reconciliação financeira (transação Mongo,
// estorno, liberação de lock) a este serviço. Sem mocká-lo, ele consultava o banco de
// verdade, não achava a corrida forjada nos mocks e devolvia RIDE_NOT_FOUND — por isso
// o teste de cancelamento já falhava antes desta mudança. Aqui só interessa QUEM pode
// cancelar e QUANDO; a reconciliação em si tem cobertura própria.
jest.mock('../../services/cancellationReconciliation.service', () => ({
    reconcileRideCancellation: jest.fn(async ({ rideId }) => ({
        _id: rideId,
        source: 'driver_initiated',
        status: 'cancelled',
        cancelledBy: 'captain',
    })),
    reconcileParcelCancellation: jest.fn(),
}));

const mockCreatedRide = {
    _id: 'ride1',
    source: 'driver_initiated',
    status: 'accepted',
    otp: '123456',
    destinationPending: true,
    captain: 'cap1',
};

jest.mock('../../models/ride.model', () => {
    const create = jest.fn().mockResolvedValue(mockCreatedRide);
    const exists = jest.fn().mockResolvedValue(false);
    const findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
            populate: jest.fn().mockReturnValue({
                select: jest.fn().mockResolvedValue({ ...mockCreatedRide, otp: '123456' }),
            }),
        }),
    });
    const findOne = jest.fn();
    const findOneAndUpdate = jest.fn();
    const findByIdAndUpdate = jest.fn();
    return {
        create,
        exists,
        findById,
        findOne,
        findOneAndUpdate,
        findByIdAndUpdate,
    };
});

const rideService = require('../../services/ride.service');
const rideModel = require('../../models/ride.model');
const dispatchService = require('../../services/dispatch.service');
const PricingEngine = require('../../services/pricingEngine.service');
const mapService = require('../../services/maps.service');

describe('createPresentialRide', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        dispatchService.acquireCaptainBusyLock.mockResolvedValue(true);
        dispatchService.captainHasActiveParcel.mockResolvedValue(false);
        rideModel.exists.mockResolvedValue(false);
        require('../../models/captain.model').findById.mockResolvedValue({ ...mockCaptainDoc });
    });

    test('cria corrida com destinationPending sem despacho e com source driver_initiated', async () => {
        const ride = await rideService.createPresentialRide({
            captain: mockCaptainDoc,
            destinationPending: true,
            clientLat: -20.15,
            clientLng: -41.62,
        });

        expect(rideModel.create).toHaveBeenCalledWith(expect.objectContaining({
            source: 'driver_initiated',
            destinationPending: true,
            status: 'accepted',
            captain: 'cap1',
            fare: 0,
        }));
        const payload = rideModel.create.mock.calls[0][0];
        expect(payload.destination).toBeUndefined();
        expect(ride.otp).toBe('123456');
        expect(dispatchService.acquireCaptainBusyLock).toHaveBeenCalled();
    });

    test('com destino informa PricingEngine e persiste estimativa', async () => {
        await rideService.createPresentialRide({
            captain: mockCaptainDoc,
            destination: 'Praça Central',
            destinationPending: false,
            clientLat: -20.15,
            clientLng: -41.62,
        });

        expect(mapService.getDistanceTime).toHaveBeenCalled();
        expect(PricingEngine.calculateFare).toHaveBeenCalled();
        expect(rideModel.create).toHaveBeenCalledWith(expect.objectContaining({
            destination: 'Praça Central',
            destinationPending: false,
            fare: 18.5,
            source: 'driver_initiated',
            status: 'accepted',
        }));
    });

    test('bloqueia motorista ocupado', async () => {
        dispatchService.acquireCaptainBusyLock.mockResolvedValue(false);
        await expect(rideService.createPresentialRide({
            captain: mockCaptainDoc,
            destinationPending: true,
            clientLat: -20.15,
            clientLng: -41.62,
        })).rejects.toMatchObject({ code: 'CAPTAIN_BUSY' });
    });

    test('bloqueia motorista não aprovado', async () => {
        require('../../models/captain.model').findById.mockResolvedValue({
            ...mockCaptainDoc,
            approvalStatus: 'pendente',
        });
        await expect(rideService.createPresentialRide({
            captain: { ...mockCaptainDoc, approvalStatus: 'pendente' },
            destinationPending: true,
            clientLat: -20.15,
            clientLng: -41.62,
        })).rejects.toMatchObject({ code: 'CAPTAIN_NOT_ALLOWED' });
    });

    test('bloqueia GPS inválido', async () => {
        require('../../models/captain.model').findById.mockResolvedValue({
            ...mockCaptainDoc,
            location: { ltd: 0, lng: 0 },
        });
        await expect(rideService.createPresentialRide({
            captain: mockCaptainDoc,
            destinationPending: true,
            clientLat: 0,
            clientLng: 0,
        })).rejects.toMatchObject({ code: 'INVALID_CAPTAIN_LOCATION' });
    });

    test('rejeita paymentMethod diferente de cash', async () => {
        await expect(rideService.createPresentialRide({
            captain: mockCaptainDoc,
            destinationPending: true,
            paymentMethod: 'card',
            clientLat: -20.15,
            clientLng: -41.62,
        })).rejects.toMatchObject({ code: 'PRESENTIAL_CASH_ONLY' });
    });
});

describe('getCurrentRideForCaptain otp visibility', () => {
    function mockFindOneChain(doc) {
        const chain = {
            populate: jest.fn().mockReturnThis(),
            select: jest.fn().mockResolvedValue(doc),
            then: undefined,
        };
        // Último populate resolve o documento (padrão do service sem .select na 1ª query).
        chain.populate = jest.fn(() => chain);
        // Quando o código faz .populate().populate() e aguarda, precisa ser thenable.
        const thenable = Promise.resolve(doc);
        chain.then = thenable.then.bind(thenable);
        chain.catch = thenable.catch.bind(thenable);
        rideModel.findOne.mockReturnValue(chain);
        return chain;
    }

    test('não expõe otp em corrida normal', async () => {
        const normalRide = {
            _id: 'ride-normal',
            source: 'passenger_requested',
            status: 'accepted',
        };
        mockFindOneChain(normalRide);
        rideModel.findById.mockClear();
        const result = await rideService.getCurrentRideForCaptain({ captain: 'cap1' });
        expect(result.source).toBe('passenger_requested');
        expect(rideModel.findById).not.toHaveBeenCalled();
    });

    test('expõe otp só em corrida presencial', async () => {
        const presential = {
            _id: 'ride-pres',
            source: 'driver_initiated',
            status: 'accepted',
        };
        mockFindOneChain(presential);
        rideModel.findById.mockReturnValue({
            populate: jest.fn().mockReturnValue({
                populate: jest.fn().mockReturnValue({
                    select: jest.fn().mockResolvedValue({ ...presential, otp: '654321' }),
                }),
            }),
        });
        const result = await rideService.getCurrentRideForCaptain({ captain: 'cap1' });
        expect(result.otp).toBe('654321');
    });
});

describe('cancelRideByCaptain presential', () => {
    test('cancela terminalmente sem requeue', async () => {
        rideModel.findOne.mockResolvedValue({
            _id: 'ride1',
            source: 'driver_initiated',
            status: 'accepted',
            captain: 'cap1',
        });
        rideModel.findOneAndUpdate.mockResolvedValue({
            _id: 'ride1',
            source: 'driver_initiated',
            status: 'cancelled',
        });
        rideModel.findById.mockReturnValue({
            populate: jest.fn().mockResolvedValue({
                _id: 'ride1',
                source: 'driver_initiated',
                status: 'cancelled',
            }),
        });

        const result = await rideService.cancelRideByCaptain({
            rideId: 'ride1',
            captain: 'cap1',
            reason: 'engano',
        });

        // A escrita em si é do serviço de reconciliação (transação + estorno). O que
        // cabe verificar aqui é o contrato: cancelamento de presencial parte do
        // motorista e nunca volta pro pool de despacho.
        const { reconcileRideCancellation } = require('../../services/cancellationReconciliation.service');
        expect(reconcileRideCancellation).toHaveBeenCalledWith(
            expect.objectContaining({
                rideId: 'ride1',
                actor: 'captain',
                allowedOrigins: expect.arrayContaining(['accepted', 'started']),
            })
        );
        expect(result.status).toBe('cancelled');
        expect(dispatchService.releaseCaptainBusyLock).toHaveBeenCalled();
    });

    // Sem janela de tempo, o motorista rodava a viagem inteira e cancelava no fim: a
    // corrida sumia, o passageiro pagava em mãos e a plataforma não recebia comissão
    // nenhuma. A trava vive no backend porque esconder o botão no app não impede uma
    // chamada direta ao endpoint nem uma versão antiga instalada.
    const startedRide = (startedAt) => ({
        _id: 'ride1',
        source: 'driver_initiated',
        status: 'started',
        captain: 'cap1',
        startedAt,
    });

    test('permite desfazer engano logo depois de iniciar', async () => {
        rideModel.findOne.mockResolvedValue(startedRide(new Date(Date.now() - 20 * 1000)));
        rideModel.findOneAndUpdate.mockResolvedValue({ _id: 'ride1', status: 'cancelled' });
        rideModel.findById.mockReturnValue({
            populate: jest.fn().mockResolvedValue({ _id: 'ride1', status: 'cancelled' }),
        });

        const result = await rideService.cancelRideByCaptain({
            rideId: 'ride1', captain: 'cap1', reason: 'engano',
        });

        expect(result.status).toBe('cancelled');
    });

    test('recusa cancelamento depois da janela de 1 minuto', async () => {
        rideModel.findOne.mockResolvedValue(startedRide(new Date(Date.now() - 15 * 60 * 1000)));

        await expect(rideService.cancelRideByCaptain({
            rideId: 'ride1', captain: 'cap1', reason: 'mudei de ideia',
        })).rejects.toMatchObject({ code: 'PRESENTIAL_CANCEL_WINDOW_EXPIRED' });

        expect(rideModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('corrida sem startedAt não abre exceção para cancelar', async () => {
        rideModel.findOne.mockResolvedValue(startedRide(null));

        await expect(rideService.cancelRideByCaptain({
            rideId: 'ride1', captain: 'cap1',
        })).rejects.toMatchObject({ code: 'PRESENTIAL_CANCEL_WINDOW_EXPIRED' });
    });

    // A janela vale só depois do embarque. Antes de iniciar não há serviço prestado —
    // limitar aí prenderia o motorista numa corrida que o passageiro nem apareceu.
    test('antes de iniciar continua cancelável sem limite de tempo', async () => {
        rideModel.findOne.mockResolvedValue({
            _id: 'ride1',
            source: 'driver_initiated',
            status: 'waiting_passenger',
            captain: 'cap1',
            createdAt: new Date(Date.now() - 60 * 60 * 1000),
        });
        rideModel.findOneAndUpdate.mockResolvedValue({ _id: 'ride1', status: 'cancelled' });
        rideModel.findById.mockReturnValue({
            populate: jest.fn().mockResolvedValue({ _id: 'ride1', status: 'cancelled' }),
        });

        const result = await rideService.cancelRideByCaptain({
            rideId: 'ride1', captain: 'cap1', reason: 'passageiro não apareceu',
        });

        expect(result.status).toBe('cancelled');
    });
});
