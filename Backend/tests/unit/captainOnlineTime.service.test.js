const captainService = require('../../services/captain.service');
const captainModel = require('../../models/captain.model');
const mongoose = require('mongoose');

// Regression coverage for A6: onlineTime era uma string mockada fixa ("05:32") para
// todo motorista, todo dia. Agora é calculado a partir de onlineSince/onlineTimeSeconds.
describe('Captain Service — Online Time Tracking', () => {
    let captainId;

    beforeEach(async () => {
        captainId = new mongoose.Types.ObjectId();
        await captainModel.create({
            _id: captainId,
            fullname: { firstname: 'Test', lastname: 'Driver' },
            email: 'online-driver@test.com',
            phone: '+5511999999999',
            password: 'password123',
            vehicle: { color: 'black', plate: 'TEST5555', capacity: 4, vehicleType: 'car' }
        });
    });

    it('should return 0 when the driver never went online', async () => {
        const seconds = await captainService.getTodayOnlineSeconds(captainId);
        expect(seconds).toBe(0);
    });

    it('should count elapsed time for the current session while still online', async () => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        await captainModel.findByIdAndUpdate(captainId, { isOnline: true, onlineSince: fiveMinutesAgo });

        const seconds = await captainService.getTodayOnlineSeconds(captainId);
        expect(seconds).toBeGreaterThanOrEqual(299); // ~5 min, tolerância de 1s
        expect(seconds).toBeLessThanOrEqual(310);
    });

    it('should accumulate onlineTimeSeconds and todayOnlineSeconds when the session ends', async () => {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        await captainModel.findByIdAndUpdate(captainId, { isOnline: true, onlineSince: tenMinutesAgo });

        await captainService.endOnlineSession(captainId);

        const captain = await captainModel.findById(captainId);
        expect(captain.onlineSince).toBeNull();
        expect(captain.onlineTimeSeconds).toBeGreaterThanOrEqual(599);
        expect(captain.todayOnlineSeconds).toBeGreaterThanOrEqual(599);
    });

    it('should accumulate across multiple sessions in the same day', async () => {
        await captainModel.findByIdAndUpdate(captainId, { isOnline: true, onlineSince: new Date(Date.now() - 60 * 1000) });
        await captainService.endOnlineSession(captainId);

        await captainService.startOnlineSession(captainId);
        await captainModel.findByIdAndUpdate(captainId, { onlineSince: new Date(Date.now() - 60 * 1000) });
        await captainService.endOnlineSession(captainId);

        const captain = await captainModel.findById(captainId);
        expect(captain.todayOnlineSeconds).toBeGreaterThanOrEqual(119); // ~2 min somados
    });

    it('should reset todayOnlineSeconds when the accumulated day is not today', async () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        await captainModel.findByIdAndUpdate(captainId, {
            todayOnlineDate: yesterday,
            todayOnlineSeconds: 9999,
            isOnline: true,
            onlineSince: new Date(Date.now() - 60 * 1000)
        });

        await captainService.endOnlineSession(captainId);

        const captain = await captainModel.findById(captainId);
        // Não deve carregar os 9999s de ontem — só a sessão de hoje (~60s)
        expect(captain.todayOnlineSeconds).toBeLessThan(200);
    });

    it('should do nothing when ending a session that never started', async () => {
        await captainService.endOnlineSession(captainId);
        const captain = await captainModel.findById(captainId);
        expect(captain.onlineTimeSeconds).toBe(0);
    });
});
