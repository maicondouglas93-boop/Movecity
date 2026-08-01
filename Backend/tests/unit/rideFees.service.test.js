const rideService = require('../../services/ride.service');
const rideModel = require('../../models/ride.model');
const tariffSettingModel = require('../../models/tariffSetting.model');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');

// Regression coverage for A9: cancellationFee e perMinuteWaitFee/maxFreeWaitTime eram
// campos editáveis no painel que nenhum código lia — o admin salvava "com sucesso" e
// nada acontecia.
describe('Ride Service — cancellation & wait-time fees', () => {
    beforeEach(async () => {
        await tariffSettingModel.create({
            maxFreeWaitTime: 300, // 5 min grátis
            perMinuteWaitFee: 1.0,
            cancellationFee: 7.5
        });
    });

    describe('cancelRide', () => {
        it('should charge the cancellation fee when a captain is already assigned', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted' });

            const result = await rideService.cancelRide({ rideId: ride._id, user: user._id });

            expect(result.cancellationFeeCharged).toBe(7.5);
        });

        it('should NOT charge a cancellation fee when no captain has accepted yet', async () => {
            const user = await createUser();
            const ride = await createRide({ user: user._id, captain: null, status: 'requested' });

            const result = await rideService.cancelRide({ rideId: ride._id, user: user._id });

            expect(result.cancellationFeeCharged).toBe(0);
        });
    });

    describe('startRide', () => {
        it('should charge a wait-time fee when the driver waited past the free window', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'arrived', arrivedAt: tenMinutesAgo, otp: '1234'
            });

            const result = await rideService.startRide({ rideId: ride._id, otp: '1234', captain });

            // 10 min de espera - 5 min grátis = 5 min excedentes * R$1,00/min = R$5,00
            expect(result.waitTimeFeeCharged).toBeCloseTo(5.0, 1);
        });

        it('should NOT charge a wait-time fee within the free window', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'arrived', arrivedAt: oneMinuteAgo, otp: '1234'
            });

            const result = await rideService.startRide({ rideId: ride._id, otp: '1234', captain });

            expect(result.waitTimeFeeCharged).toBe(0);
        });

        it('should NOT charge a wait-time fee when the driver never marked arrived', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'accepted', otp: '1234'
            });

            const result = await rideService.startRide({ rideId: ride._id, otp: '1234', captain });

            expect(result.waitTimeFeeCharged).toBe(0);
        });
    });

    describe('endRide', () => {
        it('should add the wait-time fee charged at startRide to the final price', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'started',
                fare: 20, waitTimeFeeCharged: 5, actualDistance: 0
            });

            const result = await rideService.endRide({ rideId: ride._id, captain });

            expect(result.finalPrice).toBe(25); // 20 (fare, sem recálculo por distância) + 5 de espera
        });
    });
});
