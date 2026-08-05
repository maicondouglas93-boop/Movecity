const mongoose = require('mongoose');

jest.mock('../../controllers/ride.controller', () => ({
    dispatchRideToCaptains: jest.fn().mockResolvedValue(1),
}));

jest.mock('../../controllers/parcel.controller', () => ({
    dispatchParcelToCaptains: jest.fn().mockResolvedValue(1),
}));

const rideController = require('../../controllers/ride.controller');
const parcelController = require('../../controllers/parcel.controller');
const scheduleService = require('../../services/schedule.service');
const rideService = require('../../services/ride.service');
const rideModel = require('../../models/ride.model');
const parcelModel = require('../../models/parcel.model');
const { createUser } = require('../factories/user.factory');

const MAX = scheduleService.MAX_DISPATCH_ROUNDS;
const ORIGIN = { lat: -20.151, lng: -41.622 };

function makeRideDoc(overrides = {}) {
    return {
        user: new mongoose.Types.ObjectId(),
        pickup: 'Rua Origem, Centro, Lajinha - MG',
        destination: 'Rua Destino, Centro, Lajinha - MG',
        fare: 20,
        vehicleType: 'car',
        otp: '123456',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
        pickupCoordinates: { ...ORIGIN },
        source: 'passenger_requested',
        ...overrides,
    };
}

function makeParcelDoc(overrides = {}) {
    return {
        user: new mongoose.Types.ObjectId(),
        vehicleType: 'moto',
        pickup: 'Rua Origem, Centro, Lajinha - MG',
        destination: 'Rua Destino, Centro, Lajinha - MG',
        pickupCoordinates: { ...ORIGIN },
        sender: { name: 'Remetente', phone: '33999999999' },
        recipient: { name: 'Destinatario', phone: '33888888888' },
        itemName: 'Envelope',
        category: 'documento',
        weightKg: 1,
        size: 'small',
        fare: 15,
        deliveryPin: '4321',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
        schedule: { mode: 'later', at: new Date(Date.now() + 5 * 60 * 1000) },
        statusHistory: [{ status: 'scheduled', at: new Date(), by: 'user' }],
        ...overrides,
    };
}

describe('Fase 2 — agendamento (SCH-A2/M1/M2/M3)', () => {
    beforeEach(async () => {
        await rideModel.deleteMany({});
        await parcelModel.deleteMany({});
        jest.clearAllMocks();
        rideController.dispatchRideToCaptains.mockResolvedValue(1);
        parcelController.dispatchParcelToCaptains.mockResolvedValue(1);
    });

    describe('SCH-A2 — 0 captains → rounds → no_drivers', () => {
        it('ride: 0 captains mantém requested até MAX e então cancela no_drivers', async () => {
            const ride = await rideModel.create(makeRideDoc());
            rideController.dispatchRideToCaptains.mockResolvedValue(0);

            await scheduleService.activateDueRides();
            let doc = await rideModel.findById(ride._id);
            expect(doc.status).toBe('requested');
            expect(doc.dispatchAttempts).toBe(1);
            expect(doc.activatedAt).toBeTruthy();

            // Simula rounds seguintes (redispatch) até esgotar.
            for (let i = 1; i < MAX; i += 1) {
                await rideModel.updateOne(
                    { _id: ride._id },
                    { $set: { activatedAt: new Date(Date.now() - 60 * 1000) } }
                );
                await scheduleService.redispatchOpenScheduledRides();
            }

            doc = await rideModel.findById(ride._id);
            expect(doc.status).toBe('cancelled');
            expect(doc.cancellationReason).toBe('no_drivers');
            expect(doc.dispatchAttempts).toBe(MAX);
        });

        it('parcel: 0 captains NÃO cancela na 1ª tentativa; cancela após MAX', async () => {
            const parcel = await parcelModel.create(makeParcelDoc());
            parcelController.dispatchParcelToCaptains.mockResolvedValue(0);

            await scheduleService.activateDueParcels();
            let doc = await parcelModel.findById(parcel._id);
            expect(doc.status).toBe('awaiting_provider');
            expect(doc.dispatchAttempts).toBe(1);

            for (let i = 1; i < MAX; i += 1) {
                await parcelModel.updateOne(
                    { _id: parcel._id },
                    { $set: { activatedAt: new Date(Date.now() - 60 * 1000) } }
                );
                await scheduleService.redispatchOpenScheduledParcels();
            }

            doc = await parcelModel.findById(parcel._id);
            expect(doc.status).toBe('cancelled');
            expect(doc.cancellationReason).toBe('no_drivers');
            expect(doc.dispatchAttempts).toBe(MAX);
        });
    });

    describe('SCH-M1 — índices e sort do cron', () => {
        it('índices status+scheduledAt existem em ride e parcel', async () => {
            await rideModel.syncIndexes();
            await parcelModel.syncIndexes();
            const rideIdx = await rideModel.collection.indexes();
            const parcelIdx = await parcelModel.collection.indexes();
            const has = (indexes, keys) => indexes.some((i) => {
                const k = Object.keys(i.key || {});
                return keys.every((key) => k.includes(key));
            });
            expect(has(rideIdx, ['status', 'scheduledAt'])).toBe(true);
            expect(has(parcelIdx, ['status', 'scheduledAt'])).toBe(true);
        });

        it('activateDueRides processa na ordem scheduledAt asc', async () => {
            const older = await rideModel.create(makeRideDoc({
                scheduledAt: new Date(Date.now() - 2 * 60 * 1000),
            }));
            const newer = await rideModel.create(makeRideDoc({
                scheduledAt: new Date(Date.now() - 1 * 60 * 1000),
            }));
            const order = [];
            rideController.dispatchRideToCaptains.mockImplementation(async (ride) => {
                order.push(ride._id.toString());
                return 1;
            });
            await scheduleService.activateDueRides();
            expect(order[0]).toBe(older._id.toString());
            expect(order[1]).toBe(newer._id.toString());
        });
    });

    describe('SCH-M3 — lista e cancel pós-activate', () => {
        it('listUserScheduled inclui requested com scheduledAt', async () => {
            const user = await createUser({ email: `sch_${Date.now()}@test.com` });
            const ride = await rideModel.create(makeRideDoc({
                user: user._id,
                status: 'requested',
                activatedAt: new Date(),
                scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
            }));
            const list = await scheduleService.listUserScheduled(user._id);
            expect(list.some((i) => i._id.toString() === ride._id.toString())).toBe(true);
            expect(list.find((i) => i._id.toString() === ride._id.toString()).status).toBe('requested');
        });

        it('cancelUserScheduled cancela awaiting_provider agendada', async () => {
            const user = await createUser({ email: `can_${Date.now()}@test.com` });
            const parcel = await parcelModel.create(makeParcelDoc({
                user: user._id,
                status: 'awaiting_provider',
                activatedAt: new Date(),
            }));
            const result = await scheduleService.cancelUserScheduled({
                userId: user._id,
                kind: 'parcel',
                id: parcel._id,
            });
            expect(result.item.status).toBe('cancelled');
        });

        it('cancelRide via transition aceita status scheduled', async () => {
            const user = await createUser({ email: `ride_${Date.now()}@test.com` });
            const ride = await rideModel.create(makeRideDoc({ user: user._id }));
            const cancelled = await rideService.cancelRide({
                rideId: ride._id,
                user: user._id,
                reason: 'mudou de planos',
            });
            expect(cancelled.status).toBe('cancelled');
            expect(cancelled.cancelledBy).toBe('passenger');
        });
    });
});
