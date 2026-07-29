const request = require('supertest');
const app = require('../../app');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const rideModel = require('../../models/ride.model');
const vehicleCategoryModel = require('../../models/vehicleCategory.model');

describe('Ride API Integration Tests', () => {
    let userToken;
    let captainToken;
    let user;
    let captain;

    beforeEach(async () => {
        user = await createUser();
        captain = await createCaptain();
        userToken = generateAuthToken(user);
        captainToken = generateAuthToken(captain, 'captain');

        // Need to create vehicle category for pricing engine
        await vehicleCategoryModel.create({
            name: 'car',
            displayName: 'Carro',
            baseFare: 5,
            perKmRate: 1.5,
            perMinuteRate: 0.3,
            minFare: 8,
            isActive: true
        });
    });

    describe('POST /rides/create', () => {
        it('should create a new ride', async () => {
            const res = await request(app)
                .post('/rides/create')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    pickup: 'Avenida Paulista, 1000',
                    destination: 'Avenida Faria Lima, 2000',
                    vehicleType: 'car',
                    paymentMethod: 'Pix'
                });

            expect(res.statusCode).toBe(201); // or 200 depending on controller
            expect(res.body).toHaveProperty('user');
            expect(res.body.user.toString()).toBe(user._id.toString());
        });

        it('should fail if unauthenticated', async () => {
            const res = await request(app)
                .post('/rides/create')
                .send({
                    pickup: 'A',
                    destination: 'B',
                    vehicleType: 'car'
                });

            expect(res.statusCode).toBe(401);
        });
    });

    describe('POST /rides/confirm', () => {
        it('should allow captain to confirm a ride', async () => {
            const ride = await createRide({ user: user._id, status: 'requested' });

            const res = await request(app)
                .post('/rides/confirm')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({
                    rideId: ride._id
                });

            expect(res.statusCode).toBe(200);
            
            const updatedRide = await rideModel.findById(ride._id);
            expect(updatedRide.status).toBe('accepted');
            expect(updatedRide.captain.toString()).toBe(captain._id.toString());
        });
    });
});
