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

        expect(rideModel.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ source: 'driver_initiated' }),
            expect.objectContaining({
                $set: expect.objectContaining({ status: 'cancelled', cancelledBy: 'captain' }),
            }),
            expect.any(Object)
        );
        expect(result.status).toBe('cancelled');
        expect(dispatchService.releaseCaptainBusyLock).toHaveBeenCalled();
    });
});
