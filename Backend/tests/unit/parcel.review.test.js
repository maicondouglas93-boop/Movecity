const mongoose = require('mongoose');
const parcelService = require('../../services/parcel.service');
const parcelModel = require('../../models/parcel.model');
const reviewModel = require('../../models/review.model');
const captainModel = require('../../models/captain.model');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');

describe('parcel.service reviews', () => {
    beforeEach(async () => {
        await parcelModel.deleteMany({});
        await reviewModel.deleteMany({});
    });

    const makeFinishedParcel = async ({ user, captain }) => {
        return parcelModel.create({
            user: user._id,
            captain: captain._id,
            pickup: 'Rua A',
            destination: 'Rua B',
            pickupCoordinates: { lat: -20.1, lng: -41.6 },
            destinationCoordinates: { lat: -20.2, lng: -41.7 },
            vehicleType: 'moto',
            sender: { name: 'Rem', phone: '33999999999' },
            recipient: { name: 'Dest', phone: '33888888888' },
            itemName: 'Doc',
            category: 'documento',
            weightKg: 1,
            size: 'small',
            fare: 12,
            distance: 5,
            duration: 10,
            status: 'finished',
            deliveryPin: '1234',
            schedule: { mode: 'now', at: null },
        });
    };

    it('submitReview cria review parcel e recalcula rating', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const parcel = await makeFinishedParcel({ user, captain });

        const review = await parcelService.submitReview({
            parcelId: parcel._id,
            user: user._id,
            rating: 4,
        });

        expect(review.subjectType).toBe('parcel');
        expect(review.subjectId.toString()).toBe(parcel._id.toString());
        expect(review.type).toBe('passenger_to_driver');

        const updated = await captainModel.findById(captain._id);
        expect(updated.rating).toBe(4);
    });

    it('rejeita review duplicada', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const parcel = await makeFinishedParcel({ user, captain });

        await parcelService.submitReview({ parcelId: parcel._id, user: user._id, rating: 5 });
        await expect(parcelService.submitReview({
            parcelId: parcel._id,
            user: user._id,
            rating: 2,
        })).rejects.toThrow('Parcel already reviewed');
    });
});
