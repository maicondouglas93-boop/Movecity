const request = require('supertest');
const app = require('../../app');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const rideModel = require('../../models/ride.model');
const parcelModel = require('../../models/parcel.model');
const vehicleCategoryModel = require('../../models/vehicleCategory.model');
const rideController = require('../../controllers/ride.controller');
const parcelController = require('../../controllers/parcel.controller');
const scheduleService = require('../../services/schedule.service');
const rideService = require('../../services/ride.service');

const ORIGIN = { lat: -23.55052, lng: -46.633308 }; // maps mock default

describe('Schedule API Integration (Fase 6.2)', () => {
    let user;
    let userToken;
    let captain;
    let captainToken;

    beforeEach(async () => {
        user = await createUser({ email: `schu_${Date.now()}@test.com` });
        captain = await createCaptain({
            email: `schc_${Date.now()}@test.com`,
            isOnline: true,
            approvalStatus: 'aprovado',
            canReceiveRides: true,
            vehicle: { color: 'black', plate: 'SCH1A11', capacity: 4, vehicleType: 'car' },
            location: { ltd: ORIGIN.lat, lng: ORIGIN.lng },
        });
        userToken = generateAuthToken(user);
        captainToken = generateAuthToken(captain, 'captain');

        await vehicleCategoryModel.create({
            name: 'car',
            displayName: 'Carro',
            baseFare: 5,
            perKmRate: 1.5,
            perMinuteRate: 0.3,
            minFare: 8,
            isActive: true,
        });
        await vehicleCategoryModel.create({
            name: 'moto',
            displayName: 'Moto',
            baseFare: 3,
            perKmRate: 1.0,
            perMinuteRate: 0.2,
            minFare: 5,
            isActive: true,
        });
    });

    it('POST /rides/create scheduled → 201, status scheduled, sem dispatch', async () => {
        const spy = jest.spyOn(rideController, 'dispatchRideToCaptains').mockResolvedValue(0);

        const res = await request(app)
            .post('/rides/create')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
                pickup: 'Avenida Paulista, 1000',
                destination: 'Avenida Faria Lima, 2000',
                vehicleType: 'car',
                paymentMethod: 'pix',
                scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            });

        expect(res.statusCode).toBe(201);
        expect(res.body.status).toBe('scheduled');
        expect(res.body.scheduledAt).toBeTruthy();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('activate → pending no raio; createdAt antigo não expira', async () => {
        const dispatchSpy = jest.spyOn(rideController, 'dispatchRideToCaptains').mockResolvedValue(1);

        const ride = await rideModel.create({
            user: user._id,
            pickup: 'Avenida Paulista, 1000',
            destination: 'Avenida Faria Lima, 2000',
            fare: 25,
            vehicleType: 'car',
            otp: '654321',
            status: 'scheduled',
            scheduledAt: new Date(Date.now() + 2 * 60 * 1000),
            pickupCoordinates: { ...ORIGIN },
            source: 'passenger_requested',
        });
        const oldCreated = new Date(Date.now() - 3 * 60 * 60 * 1000);
        await rideModel.collection.updateOne(
            { _id: ride._id },
            { $set: { createdAt: oldCreated, updatedAt: oldCreated } }
        );

        await scheduleService.activateDueRides();

        const after = await rideModel.findById(ride._id);
        expect(after.status).toBe('requested');
        expect(after.activatedAt).toBeTruthy();
        expect(Math.abs(new Date(after.createdAt).getTime() - oldCreated.getTime())).toBeLessThan(1000);

        const current = await rideService.getCurrentRide({ user: user._id });
        expect(current).toBeTruthy();
        expect(current._id.toString()).toBe(ride._id.toString());

        const pendingRes = await request(app)
            .get('/rides/pending')
            .set('Authorization', `Bearer ${captainToken}`);

        expect(pendingRes.statusCode).toBe(200);
        expect(Array.isArray(pendingRes.body)).toBe(true);
        expect(pendingRes.body.some((r) => r._id.toString() === ride._id.toString())).toBe(true);

        dispatchSpy.mockRestore();
    });

    it('parcel schedule → activate com 0 captains → no_drivers após MAX rounds', async () => {
        jest.spyOn(parcelController, 'dispatchParcelToCaptains').mockResolvedValue(0);

        const parcel = await parcelModel.create({
            user: user._id,
            vehicleType: 'moto',
            pickup: 'Rua A',
            destination: 'Rua B',
            pickupCoordinates: { ...ORIGIN },
            sender: { name: 'R', phone: '33999999999' },
            recipient: { name: 'D', phone: '33888888888' },
            itemName: 'Doc',
            category: 'documento',
            weightKg: 1,
            size: 'small',
            fare: 12,
            deliveryPin: '1111',
            status: 'scheduled',
            scheduledAt: new Date(Date.now() + 2 * 60 * 1000),
            schedule: { mode: 'later', at: new Date(Date.now() + 2 * 60 * 1000) },
            statusHistory: [{ status: 'scheduled', at: new Date(), by: 'user' }],
            paymentMethod: 'cash',
        });

        await scheduleService.activateDueParcels();
        let doc = await parcelModel.findById(parcel._id);
        expect(doc.status).toBe('awaiting_provider');
        expect(doc.dispatchAttempts).toBe(1);

        const MAX = scheduleService.MAX_DISPATCH_ROUNDS;
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
    });

    it('GET captain upcoming isola por raio/veículo', async () => {
        await rideModel.create({
            user: user._id,
            pickup: 'Av. Paulista, 100',
            destination: 'Av. Faria Lima, 200',
            fare: 30,
            vehicleType: 'car',
            otp: '222222',
            status: 'scheduled',
            scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
            pickupCoordinates: { ...ORIGIN },
            source: 'passenger_requested',
        });

        const nearRes = await request(app)
            .get('/captains/scheduled-upcoming')
            .set('Authorization', `Bearer ${captainToken}`);
        expect(nearRes.statusCode).toBe(200);
        expect(nearRes.body.upcoming.length).toBeGreaterThanOrEqual(1);

        const farCaptain = await createCaptain({
            email: `far_${Date.now()}@test.com`,
            isOnline: true,
            approvalStatus: 'aprovado',
            canReceiveRides: true,
            vehicle: { color: 'black', plate: 'FAR9Z99', capacity: 4, vehicleType: 'car' },
            location: { ltd: ORIGIN.lat + 0.5, lng: ORIGIN.lng },
        });
        const farToken = generateAuthToken(farCaptain, 'captain');
        const farRes = await request(app)
            .get('/captains/scheduled-upcoming')
            .set('Authorization', `Bearer ${farToken}`);
        expect(farRes.statusCode).toBe(200);
        expect(farRes.body.upcoming).toHaveLength(0);
    });

    it('POST /schedules/mine/cancel valida body (400) e cancela o dono', async () => {
        const bad = await request(app)
            .post('/schedules/mine/cancel')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ kind: 'invalid', id: 'not-an-id' });
        expect(bad.statusCode).toBe(400);

        const ride = await rideModel.create({
            user: user._id,
            pickup: 'Rua A',
            destination: 'Rua B',
            fare: 20,
            vehicleType: 'car',
            otp: '333333',
            status: 'scheduled',
            scheduledAt: new Date(Date.now() + 3600000),
            source: 'passenger_requested',
        });

        const ok = await request(app)
            .post('/schedules/mine/cancel')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ kind: 'ride', id: ride._id.toString() });
        expect(ok.statusCode).toBe(200);

        const doc = await rideModel.findById(ride._id);
        expect(doc.status).toBe('cancelled');
    });
});
