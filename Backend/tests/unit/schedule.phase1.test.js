const mongoose = require('mongoose');

jest.mock('../../controllers/ride.controller', () => ({
    dispatchRideToCaptains: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../controllers/parcel.controller', () => ({
    dispatchParcelToCaptains: jest.fn().mockResolvedValue(1),
}));

const rideController = require('../../controllers/ride.controller');
const parcelController = require('../../controllers/parcel.controller');
const scheduleService = require('../../services/schedule.service');
const rideService = require('../../services/ride.service');
const parcelService = require('../../services/parcel.service');
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

function makeParcelDoc(overrides = {}) {
    return {
        user: new mongoose.Types.ObjectId(),
        vehicleType: 'moto',
        pickup: 'Rua Origem, Centro, Lajinha - MG',
        destination: 'Rua Destino, Centro, Lajinha - MG',
        pickupCoordinates: { ...ORIGIN },
        sender: { name: 'Remetente Secret', phone: '33999999999' },
        recipient: { name: 'Destinatario Secret', phone: '33888888888' },
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

describe('Fase 1 — agendamento (SCH-C1/C2/C3/A1)', () => {
    beforeEach(async () => {
        await rideModel.deleteMany({});
        await parcelModel.deleteMany({});
        await captainModel.deleteMany({});
        jest.clearAllMocks();
        rideController.dispatchRideToCaptains.mockResolvedValue(undefined);
        parcelController.dispatchParcelToCaptains.mockResolvedValue(1);
    });

    describe('SCH-C1 — ride activatedAt clock', () => {
        it('ativação grava activatedAt sem alterar createdAt e não expira nos 10min', async () => {
            const oldCreated = new Date(Date.now() - 3 * 60 * 60 * 1000);
            const ride = await rideModel.create(makeRideDoc());
            await rideModel.collection.updateOne(
                { _id: ride._id },
                { $set: { createdAt: oldCreated, updatedAt: oldCreated } }
            );

            const before = await rideModel.findById(ride._id);
            expect(before.status).toBe('scheduled');
            expect(before.activatedAt).toBeNull();

            await scheduleService.activateDueRides();

            const after = await rideModel.findById(ride._id);
            expect(after.status).toBe('requested');
            expect(after.activatedAt).toBeTruthy();
            expect(Math.abs(after.activatedAt.getTime() - Date.now())).toBeLessThan(5000);
            expect(Math.abs(new Date(after.createdAt).getTime() - oldCreated.getTime())).toBeLessThan(1000);

            const current = await rideService.getCurrentRide({ user: after.user });
            expect(current).toBeTruthy();
            expect(current.status).toBe('requested');

            const captain = await createCaptain({
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'black', plate: 'ABC1D23', capacity: 4, vehicleType: 'car' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });
            const pending = await rideService.getPendingRidesForCaptain({ captain });
            expect(pending.some((r) => r._id.toString() === after._id.toString())).toBe(true);
        });

        it('corrida imediata (activatedAt null + createdAt recente) continua no pending', async () => {
            const ride = await rideModel.create(makeRideDoc({
                status: 'requested',
                scheduledAt: null,
                activatedAt: null,
            }));
            const captain = await createCaptain({
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'black', plate: 'XYZ9Z99', capacity: 4, vehicleType: 'car' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });
            const pending = await rideService.getPendingRidesForCaptain({ captain });
            expect(pending.some((r) => r._id.toString() === ride._id.toString())).toBe(true);
        });
    });

    describe('SCH-C2 — parcel activatedAt clock', () => {
        it('parcel agendada ativada não expira nos 10min apesar de createdAt antigo', async () => {
            const oldCreated = new Date(Date.now() - 3 * 60 * 60 * 1000);
            const parcel = await parcelModel.create(makeParcelDoc());
            await parcelModel.collection.updateOne(
                { _id: parcel._id },
                { $set: { createdAt: oldCreated, updatedAt: oldCreated } }
            );

            await scheduleService.activateDueParcels();

            const after = await parcelModel.findById(parcel._id);
            expect(after.status).toBe('awaiting_provider');
            expect(after.activatedAt).toBeTruthy();
            expect(Math.abs(new Date(after.createdAt).getTime() - oldCreated.getTime())).toBeLessThan(1000);

            await parcelService.expireStaleAwaitingParcels();
            const still = await parcelModel.findById(parcel._id);
            expect(still.status).toBe('awaiting_provider');

            const captain = await createCaptain({
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'red', plate: 'MOT1A11', capacity: 1, vehicleType: 'moto' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });
            const pending = await parcelService.getPendingParcelsForCaptain({ captain });
            expect(pending.some((p) => p._id.toString() === after._id.toString())).toBe(true);
        });

        it('parcel imediata (activatedAt null + createdAt recente) não é expirada', async () => {
            const parcel = await parcelModel.create(makeParcelDoc({
                status: 'awaiting_provider',
                scheduledAt: null,
                activatedAt: null,
                schedule: { mode: 'now', at: null },
            }));
            await parcelService.expireStaleAwaitingParcels();
            const still = await parcelModel.findById(parcel._id);
            expect(still.status).toBe('awaiting_provider');
        });
    });

    describe('SCH-C3 — listCaptainUpcoming filtrado', () => {
        const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

        async function seedRide({ vehicleType = 'car', coords = ORIGIN } = {}) {
            return rideModel.create(makeRideDoc({
                vehicleType,
                scheduledAt,
                pickupCoordinates: coords,
                pickup: 'Av. Brasil 100, Centro, Lajinha - MG',
                destination: 'Rua das Flores 50, Centro, Lajinha - MG',
            }));
        }

        it('Captain A (>15km) não recebe; B (raio+veículo) recebe; C veículo incompatível não; D offline []', async () => {
            await seedRide({ vehicleType: 'car' });

            const far = await createCaptain({
                email: `far_${Date.now()}@test.com`,
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'black', plate: 'FAR1A11', capacity: 4, vehicleType: 'car' },
                location: { ltd: ORIGIN.lat + 0.5, lng: ORIGIN.lng }, // ~55km
            });
            const near = await createCaptain({
                email: `near_${Date.now()}@test.com`,
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'black', plate: 'NER1A11', capacity: 4, vehicleType: 'car' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });
            const wrongVehicle = await createCaptain({
                email: `moto_${Date.now()}@test.com`,
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'red', plate: 'WRG1A11', capacity: 1, vehicleType: 'moto' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });
            const offline = await createCaptain({
                email: `off_${Date.now()}@test.com`,
                isOnline: false,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'black', plate: 'OFF1A11', capacity: 4, vehicleType: 'car' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });

            expect(await scheduleService.listCaptainUpcoming(far._id)).toHaveLength(0);
            const forNear = await scheduleService.listCaptainUpcoming(near._id);
            expect(forNear).toHaveLength(1);
            expect(forNear[0].kind).toBe('ride');
            expect(forNear[0].vehicleType).toBe('car');
            expect(await scheduleService.listCaptainUpcoming(wrongVehicle._id)).toHaveLength(0);
            expect(await scheduleService.listCaptainUpcoming(offline._id)).toEqual([]);
        });

        it('bloqueado não recebe; DTO sem telefone/nome completo/PII', async () => {
            await parcelModel.create(makeParcelDoc({
                vehicleType: 'moto',
                scheduledAt,
                pickupCoordinates: { ...ORIGIN },
            }));

            const blocked = await createCaptain({
                email: `blk_${Date.now()}@test.com`,
                isOnline: true,
                isBlocked: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'red', plate: 'BLK1A11', capacity: 1, vehicleType: 'moto' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });
            expect(await scheduleService.listCaptainUpcoming(blocked._id)).toEqual([]);

            const ok = await createCaptain({
                email: `ok_${Date.now()}@test.com`,
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'red', plate: 'OKK1A11', capacity: 1, vehicleType: 'moto' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });
            const items = await scheduleService.listCaptainUpcoming(ok._id);
            expect(items).toHaveLength(1);
            const dto = items[0];
            const serialized = JSON.stringify(dto);
            expect(serialized).not.toMatch(/33999999999|33888888888/);
            expect(serialized).not.toMatch(/Remetente Secret|Destinatario Secret/);
            expect(dto).not.toHaveProperty('sender');
            expect(dto).not.toHaveProperty('recipient');
            expect(dto).not.toHaveProperty('user');
            expect(dto).not.toHaveProperty('phone');
            expect(dto.pickup).toBeTruthy();
            expect(dto.pickup.length).toBeLessThan(80);
        });

        it('ordena por scheduledAt asc e limita a 20', async () => {
            const base = Date.now() + 60 * 60 * 1000;
            for (let i = 0; i < 22; i += 1) {
                await rideModel.create(makeRideDoc({
                    vehicleType: 'car',
                    scheduledAt: new Date(base + (22 - i) * 60 * 1000),
                    pickupCoordinates: { ...ORIGIN },
                }));
            }
            const near = await createCaptain({
                email: `lim_${Date.now()}@test.com`,
                isOnline: true,
                approvalStatus: 'aprovado',
                canReceiveRides: true,
                vehicle: { color: 'black', plate: 'LIM1A11', capacity: 4, vehicleType: 'car' },
                location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
            });
            const items = await scheduleService.listCaptainUpcoming(near._id);
            expect(items).toHaveLength(20);
            for (let i = 1; i < items.length; i += 1) {
                expect(new Date(items[i].scheduledAt).getTime())
                    .toBeGreaterThanOrEqual(new Date(items[i - 1].scheduledAt).getTime());
            }
        });
    });

    describe('SCH-A1 — rollback se dispatch lança', () => {
        it('ride: exception → scheduled + activatedAt null + attempts/error; retry possível', async () => {
            const ride = await rideModel.create(makeRideDoc());
            rideController.dispatchRideToCaptains.mockRejectedValueOnce(new Error('dispatch boom'));

            await scheduleService.activateDueRides();

            let doc = await rideModel.findById(ride._id);
            expect(doc.status).toBe('scheduled');
            expect(doc.activatedAt).toBeNull();
            expect(doc.dispatchAttempts).toBe(1);
            expect(doc.dispatchLastError).toMatch(/dispatch boom/);

            rideController.dispatchRideToCaptains.mockResolvedValueOnce(undefined);
            await scheduleService.activateDueRides();

            doc = await rideModel.findById(ride._id);
            expect(doc.status).toBe('requested');
            expect(doc.activatedAt).toBeTruthy();
            expect(rideController.dispatchRideToCaptains).toHaveBeenCalledTimes(2);
        });

        it('parcel: exception → scheduled + activatedAt null + attempts; retry possível', async () => {
            const parcel = await parcelModel.create(makeParcelDoc());
            parcelController.dispatchParcelToCaptains.mockRejectedValueOnce(new Error('parcel dispatch fail'));

            await scheduleService.activateDueParcels();

            let doc = await parcelModel.findById(parcel._id);
            expect(doc.status).toBe('scheduled');
            expect(doc.activatedAt).toBeNull();
            expect(doc.dispatchAttempts).toBe(1);
            expect(doc.dispatchLastError).toMatch(/parcel dispatch fail/);

            parcelController.dispatchParcelToCaptains.mockResolvedValueOnce(2);
            await scheduleService.activateDueParcels();

            doc = await parcelModel.findById(parcel._id);
            expect(doc.status).toBe('awaiting_provider');
            expect(doc.activatedAt).toBeTruthy();
            expect(parcelController.dispatchParcelToCaptains).toHaveBeenCalledTimes(2);
        });
    });
});
