const rideService = require('../../services/ride.service');
const reviewModel = require('../../models/review.model');
const captainModel = require('../../models/captain.model');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');

// Regression coverage for A5: rating do motorista nunca era escrito por nenhum fluxo
// (sempre ficava no default 5.0 do schema, mesmo com avaliações ruins).
describe('Ride Service — submitReview', () => {
    it('should create a review and recalculate captain.rating', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'finished' });

        const review = await rideService.submitReview({
            rideId: ride._id, user: user._id, rating: 3, comment: 'Ok'
        });

        expect(review.rating).toBe(3);

        const updatedCaptain = await captainModel.findById(captain._id);
        expect(updatedCaptain.rating).toBe(3);
    });

    it('should average multiple reviews', async () => {
        const captain = await createCaptain();
        const user1 = await createUser({ email: 'u1@test.com' });
        const user2 = await createUser({ email: 'u2@test.com' });
        const ride1 = await createRide({ user: user1._id, captain: captain._id, status: 'finished' });
        const ride2 = await createRide({ user: user2._id, captain: captain._id, status: 'finished' });

        await rideService.submitReview({ rideId: ride1._id, user: user1._id, rating: 5 });
        await rideService.submitReview({ rideId: ride2._id, user: user2._id, rating: 3 });

        const updatedCaptain = await captainModel.findById(captain._id);
        expect(updatedCaptain.rating).toBe(4);
    });

    it('should reject reviewing a ride that is not finished', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'started' });

        await expect(rideService.submitReview({
            rideId: ride._id, user: user._id, rating: 5
        })).rejects.toThrow('Only finished rides can be reviewed');
    });

    it('should reject a duplicate review for the same ride', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'finished' });

        await rideService.submitReview({ rideId: ride._id, user: user._id, rating: 5 });

        await expect(rideService.submitReview({
            rideId: ride._id, user: user._id, rating: 2
        })).rejects.toThrow('Ride already reviewed');

        const count = await reviewModel.countDocuments({ ride: ride._id });
        expect(count).toBe(1);
    });

    it('should reject reviewing a ride that belongs to another user', async () => {
        const owner = await createUser({ email: 'owner@test.com' });
        const stranger = await createUser({ email: 'stranger@test.com' });
        const captain = await createCaptain();
        const ride = await createRide({ user: owner._id, captain: captain._id, status: 'finished' });

        await expect(rideService.submitReview({
            rideId: ride._id, user: stranger._id, rating: 5
        })).rejects.toThrow('Ride not found');
    });
});
