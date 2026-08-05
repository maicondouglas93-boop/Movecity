jest.mock('../../notification/tokenRegistry.service', () => ({
    getTokensForUser: jest.fn().mockResolvedValue(['tok-schedule-user']),
    getTokensForCaptain: jest.fn().mockResolvedValue(['tok-schedule-captain']),
    removeInvalidTokens: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../notification/pushTransport.service', () => ({
    sendPush: jest.fn().mockResolvedValue({ successCount: 1, failureCount: 0, invalidTokens: [] }),
}));

jest.mock('../../notification/queue.service', () => ({
    enqueue: (job) => {
        // Executa síncrono nos testes (a fila real é fire-and-forget).
        return Promise.resolve().then(job);
    },
}));

const mongoose = require('mongoose');
const notificationDispatcher = require('../../notification/notificationDispatcher.service');
const pushTransport = require('../../notification/pushTransport.service');
const Notification = require('../../models/notification.model');
const scheduleService = require('../../services/schedule.service');
const rideModel = require('../../models/ride.model');
const { createUser } = require('../factories/user.factory');

jest.mock('../../controllers/ride.controller', () => ({
    dispatchRideToCaptains: jest.fn().mockResolvedValue(1),
}));

const rideController = require('../../controllers/ride.controller');

describe('Fase 3 — notificações de agendamento', () => {
    beforeEach(async () => {
        await Notification.deleteMany({});
        await rideModel.deleteMany({});
        jest.clearAllMocks();
        pushTransport.sendPush.mockResolvedValue({ successCount: 1, failureCount: 0, invalidTokens: [] });
        rideController.dispatchRideToCaptains.mockResolvedValue(1);
    });

    it('sendScheduleActivated grava SCHEDULE_ACTIVATED e envia push', async () => {
        const user = await createUser({ email: `act_${Date.now()}@test.com` });
        notificationDispatcher.sendScheduleActivated(user._id, {
            kind: 'ride',
            id: 'ride-1',
            rideId: 'ride-1',
        });

        await new Promise((r) => setTimeout(r, 150));

        const doc = await Notification.findOne({ userId: user._id, type: 'SCHEDULE_ACTIVATED' });
        expect(doc).toBeTruthy();
        expect(doc.title).toMatch(/Buscando motorista/i);
        expect(pushTransport.sendPush).toHaveBeenCalled();
        const payload = pushTransport.sendPush.mock.calls[0][1];
        expect(payload.data.deepLink).toBe('/home');
        expect(payload.data.type || doc.type).toBeTruthy();
    });

    it('sendScheduleNoDriver grava SCHEDULE_NO_DRIVER (padrão NEW_PARCEL)', async () => {
        const user = await createUser({ email: `nod_${Date.now()}@test.com` });
        notificationDispatcher.sendScheduleNoDriver(user._id, {
            kind: 'parcel',
            id: 'parcel-1',
            parcelId: 'parcel-1',
            reason: 'no_drivers',
        });

        await new Promise((r) => setTimeout(r, 150));

        const doc = await Notification.findOne({ userId: user._id, type: 'SCHEDULE_NO_DRIVER' });
        expect(doc).toBeTruthy();
        expect(doc.message).toMatch(/motorista/i);
        expect(pushTransport.sendPush).toHaveBeenCalled();
        const payload = pushTransport.sendPush.mock.calls[0][1];
        expect(payload.data.deepLink).toBe('/scheduled');
    });

    it('sendScheduleCreated usa deepLink /scheduled', async () => {
        const user = await createUser({ email: `crt_${Date.now()}@test.com` });
        notificationDispatcher.sendScheduleCreated(user._id, {
            kind: 'ride',
            id: 'ride-2',
            rideId: 'ride-2',
        });

        await new Promise((r) => setTimeout(r, 150));

        const doc = await Notification.findOne({ userId: user._id, type: 'SCHEDULE_CREATED' });
        expect(doc).toBeTruthy();
        const payload = pushTransport.sendPush.mock.calls[0][1];
        expect(payload.data.deepLink).toBe('/scheduled');
    });

    it('activateDueRides dispara notificação SCHEDULE_ACTIVATED para o user', async () => {
        const user = await createUser({ email: `wire_${Date.now()}@test.com` });
        await rideModel.create({
            user: user._id,
            pickup: 'Rua A',
            destination: 'Rua B',
            fare: 20,
            vehicleType: 'car',
            otp: '111111',
            status: 'scheduled',
            scheduledAt: new Date(Date.now() + 2 * 60 * 1000),
            pickupCoordinates: { lat: -20.1, lng: -41.6 },
            source: 'passenger_requested',
        });

        const spy = jest.spyOn(notificationDispatcher, 'sendScheduleActivated');
        await scheduleService.activateDueRides();

        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0][0].toString()).toBe(user._id.toString());
        expect(spy.mock.calls[0][1].kind).toBe('ride');
        spy.mockRestore();

        await new Promise((r) => setTimeout(r, 150));
        const doc = await Notification.findOne({ userId: user._id, type: 'SCHEDULE_ACTIVATED' });
        expect(doc).toBeTruthy();
    });

    it('oferta agendada usa conteúdo específico e deep link da oferta', async () => {
        const captainId = new mongoose.Types.ObjectId();
        notificationDispatcher.sendNewRide(captainId, {
            rideId: new mongoose.Types.ObjectId().toString(),
            isScheduled: true,
        });

        await new Promise((r) => setTimeout(r, 150));

        const doc = await Notification.findOne({ captainId, type: 'NEW_RIDE' });
        expect(doc.title).toBe('Novo agendamento disponível');
        expect(doc.message).toBe('Uma nova corrida agendada está disponível para aceite.');
        const payload = pushTransport.sendPush.mock.calls[0][1];
        expect(payload.data.deepLink).toMatch(/^\/captain-home\?rideOffer=/);
    });

    it('duas execuções não enviam duas pushes da mesma oferta ao motorista', async () => {
        const captainId = new mongoose.Types.ObjectId();
        const rideId = new mongoose.Types.ObjectId().toString();

        notificationDispatcher.sendNewRide(captainId, { rideId, isScheduled: true });
        notificationDispatcher.sendNewRide(captainId, { rideId, isScheduled: true });
        await new Promise((r) => setTimeout(r, 250));

        expect(await Notification.countDocuments({ captainId, type: 'NEW_RIDE', referenceId: rideId })).toBe(1);
        expect(pushTransport.sendPush).toHaveBeenCalledTimes(1);
    });

    it('enum aceita tipos SCHEDULE_*', () => {
        const enumValues = Notification.schema.path('type').enumValues;
        expect(enumValues).toEqual(expect.arrayContaining([
            'SCHEDULE_CREATED',
            'SCHEDULE_ACTIVATED',
            'SCHEDULE_NO_DRIVER',
            'SCHEDULE_REMINDER',
        ]));
    });
});
