const mongoose = require('mongoose');

jest.mock('../../controllers/ride.controller', () => ({
    dispatchRideToCaptains: jest.fn().mockResolvedValue(1),
}));

jest.mock('../../controllers/parcel.controller', () => ({
    dispatchParcelToCaptains: jest.fn().mockResolvedValue(1),
}));

const rideController = require('../../controllers/ride.controller');
const scheduleService = require('../../services/schedule.service');
const rideModel = require('../../models/ride.model');
const parcelModel = require('../../models/parcel.model');
const captainModel = require('../../models/captain.model');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');

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

describe('schedule.service (Fase 6.1)', () => {
    beforeEach(async () => {
        await rideModel.deleteMany({});
        await parcelModel.deleteMany({});
        await captainModel.deleteMany({});
        jest.clearAllMocks();
        rideController.dispatchRideToCaptains.mockResolvedValue(1);
    });

    describe('assertValidScheduledAt', () => {
        it('rejeita horário muito cedo', () => {
            expect(() => scheduleService.assertValidScheduledAt(
                new Date(Date.now() + 5 * 60 * 1000).toISOString()
            )).toThrow(/SCHEDULE_TOO_SOON|TOO_SOON/i);
        });

        it('rejeita horário muito longe', () => {
            expect(() => scheduleService.assertValidScheduledAt(
                new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
            )).toThrow(/SCHEDULE_TOO_FAR|TOO_FAR/i);
        });

        it('aceita janela válida', () => {
            const at = scheduleService.assertValidScheduledAt(
                new Date(Date.now() + 60 * 60 * 1000).toISOString()
            );
            expect(at).toBeInstanceOf(Date);
        });
    });

    describe('cancelUserScheduled ownership', () => {
        it('só o dono cancela', async () => {
            const owner = await createUser({ email: `own_${Date.now()}@test.com` });
            const stranger = await createUser({ email: `str_${Date.now()}@test.com` });
            const ride = await rideModel.create(makeRideDoc({ user: owner._id }));

            await expect(scheduleService.cancelUserScheduled({
                userId: stranger._id,
                kind: 'ride',
                id: ride._id,
            })).rejects.toMatchObject({ code: 'SCHEDULED_NOT_FOUND' });

            const result = await scheduleService.cancelUserScheduled({
                userId: owner._id,
                kind: 'ride',
                id: ride._id,
            });
            expect(result.item.status).toBe('cancelled');
        });
    });

    describe('activateDueRides CAS', () => {
        it('dois activates paralelos despacham só uma vez', async () => {
            const ride = await rideModel.create(makeRideDoc());
            let concurrent = 0;
            rideController.dispatchRideToCaptains.mockImplementation(async () => {
                concurrent += 1;
                await new Promise((r) => setTimeout(r, 30));
                return 1;
            });

            const [a, b] = await Promise.all([
                scheduleService.activateDueRides(),
                scheduleService.activateDueRides(),
            ]);

            expect(a.activated + b.activated).toBe(1);
            expect(rideController.dispatchRideToCaptains).toHaveBeenCalledTimes(1);
            const doc = await rideModel.findById(ride._id);
            expect(doc.status).toBe('requested');
            expect(doc.activatedAt).toBeTruthy();
        });

        it('dispatch throw → volta scheduled', async () => {
            const ride = await rideModel.create(makeRideDoc());
            rideController.dispatchRideToCaptains.mockRejectedValueOnce(new Error('boom'));

            await scheduleService.activateDueRides();

            const doc = await rideModel.findById(ride._id);
            expect(doc.status).toBe('scheduled');
            expect(doc.activatedAt).toBeNull();
            expect(doc.dispatchAttempts).toBe(1);
        });
    });

    describe('listCaptainUpcoming', () => {
        it('filtra raio e vehicleType', async () => {
            const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
            await rideModel.create(makeRideDoc({
                vehicleType: 'car',
                scheduledAt,
                pickupCoordinates: { ...ORIGIN },
            }));

            const nearCar = await createCaptain({
                email: `near_${Date.now()}@test.com`,
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'black', plate: 'AAA1A11', capacity: 4, vehicleType: 'car' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });
            const farCar = await createCaptain({
                email: `far_${Date.now()}@test.com`,
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'black', plate: 'BBB2B22', capacity: 4, vehicleType: 'car' },
                location: { ltd: ORIGIN.lat + 0.5, lng: ORIGIN.lng },
            });
            const nearMoto = await createCaptain({
                email: `moto_${Date.now()}@test.com`,
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'red', plate: 'CCC3C33', capacity: 1, vehicleType: 'moto' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });

            expect(await scheduleService.listCaptainUpcoming(nearCar._id)).toHaveLength(1);
            expect(await scheduleService.listCaptainUpcoming(farCar._id)).toHaveLength(0);
            expect(await scheduleService.listCaptainUpcoming(nearMoto._id)).toHaveLength(0);
        });
    });
});
