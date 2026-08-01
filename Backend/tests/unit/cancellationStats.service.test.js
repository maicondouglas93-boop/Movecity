const captainService = require('../../services/captain.service');
const captainModel = require('../../models/captain.model');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const { createUser } = require('../factories/user.factory');

// Regression coverage for A5/A9-adjacent: cancellationRate/cancelledRides nunca eram
// escritos por nenhum fluxo — todo motorista aparecia com 0% de cancelamento sempre,
// mesmo cancelando toda corrida.
describe('Captain Service — recalculateCancellationStats', () => {
    it('should compute 0% when the captain has no cancelled rides', async () => {
        const captain = await createCaptain();
        const user = await createUser();
        await createRide({ user: user._id, captain: captain._id, status: 'finished' });
        await createRide({ user: user._id, captain: captain._id, status: 'accepted' });

        await captainService.recalculateCancellationStats(captain._id);

        const updated = await captainModel.findById(captain._id);
        expect(updated.cancellationRate).toBe(0);
        expect(updated.cancelledRides).toBe(0);
    });

    it('should compute the correct percentage with a mix of statuses', async () => {
        const captain = await createCaptain();
        const user = await createUser();
        await createRide({ user: user._id, captain: captain._id, status: 'finished' });
        await createRide({ user: user._id, captain: captain._id, status: 'cancelled' });
        await createRide({ user: user._id, captain: captain._id, status: 'cancelled' });
        await createRide({ user: user._id, captain: captain._id, status: 'cancelled' });

        await captainService.recalculateCancellationStats(captain._id);

        const updated = await captainModel.findById(captain._id);
        expect(updated.cancellationRate).toBe(75); // 3 de 4
        expect(updated.cancelledRides).toBe(3);
    });

    it('should not count rides assigned to a different captain', async () => {
        const captainA = await createCaptain({ email: 'captainA@test.com' });
        const captainB = await createCaptain({ email: 'captainB@test.com' });
        const user = await createUser();
        await createRide({ user: user._id, captain: captainA._id, status: 'cancelled' });
        await createRide({ user: user._id, captain: captainB._id, status: 'finished' });

        await captainService.recalculateCancellationStats(captainA._id);

        const updatedA = await captainModel.findById(captainA._id);
        expect(updatedA.cancellationRate).toBe(100);

        const updatedB = await captainModel.findById(captainB._id);
        expect(updatedB.cancellationRate).toBe(0); // nunca recalculado ainda, deve manter o default
    });
});
