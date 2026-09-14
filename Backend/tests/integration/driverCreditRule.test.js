jest.mock('../../services/notification.service', () => ({
    sendRechargeApproved: jest.fn().mockResolvedValue(undefined),
    sendCreditsBlocked: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../socket', () => ({ sendMessageToSocketId: jest.fn() }));
jest.mock('node-cron', () => ({ schedule: jest.fn(() => ({ stop: jest.fn(), start: jest.fn() })) }));

const mongoose = require('mongoose');
const settingsModel = require('../../models/globalSetting.model');
const walletModel = require('../../models/wallet.model');
const captainModel = require('../../models/captain.model');
const { createCaptain } = require('../factories/captain.factory');
const credit = require('../../services/driverCredit.service');
const { createTransaction } = require('../../services/wallet.service');
require('../../models/user.model');
const rideModel = require('../../models/ride.model');
const { startRide } = require('../../services/ride.service');
const request = require('supertest');
const express = require('express');
const adminModel = require('../../models/adminUser.model');
const adminLogModel = require('../../models/adminLog.model');
const { generateAuthToken } = require('../setup/authHelper');
const app = express();
app.use(express.json());
app.use('/admin', require('../../routes/admin.routes'));

describe('regra de crédito — Mongo real de teste', () => {
    test('endpoint exige autenticação; financeiro consulta e somente administrador principal altera com auditoria', async () => {
        await settingsModel.create({ blockDriverOnNegativeBalance: true });
        expect((await request(app).get('/admin/settings/driver-credit')).status).toBe(401);
        const finance = await adminModel.create({ name: 'Financeiro Teste', email: 'finance@test.com', password: 'test-password', role: 'financeiro' });
        const financeToken = generateAuthToken(finance, 'admin');
        const read = await request(app).get('/admin/settings/driver-credit').set('Authorization', `Bearer ${financeToken}`);
        expect(read.status).toBe(200);
        expect(read.body.blockDriverOnNegativeBalance).toBe(true);
        const forbidden = await request(app).put('/admin/settings/driver-credit').set('Authorization', `Bearer ${financeToken}`)
            .send({ blockDriverOnNegativeBalance: false, version: 0 });
        expect(forbidden.status).toBe(403);
        const owner = await adminModel.create({ name: 'Proprietário Teste', email: 'owner@test.com', password: 'test-password', role: 'OWNER' });
        const saved = await request(app).put('/admin/settings/driver-credit').set('Authorization', `Bearer ${generateAuthToken(owner, 'admin')}`)
            .send({ blockDriverOnNegativeBalance: false, version: 0 });
        expect(saved.status).toBe(200);
        expect(saved.body.blockDriverOnNegativeBalance).toBe(false);
        expect(await adminLogModel.findOne({ action: 'update_driver_credit_rule', adminId: owner._id })).toMatchObject({ newValue: { blockDriverOnNegativeBalance: false } });
    });

    test('presencial criada antes do saldo negativo não inicia; desligar a regra permite iniciar', async () => {
        const captain = await createCaptain();
        await settingsModel.create({ blockDriverOnNegativeBalance: true });
        const ride = await rideModel.create({
            captain: captain._id, source: 'driver_initiated', status: 'accepted',
            pickup: 'Origem de teste', destinationPending: true, fare: 0, vehicleType: 'car',
        });
        await walletModel.create({ captainId: captain._id, creditBalance: -0.01 });
        await expect(startRide({ rideId: ride._id, captain })).rejects.toMatchObject({ code: 'DRIVER_CREDIT_BLOCKED' });
        expect((await rideModel.findById(ride._id)).status).toBe('accepted');
        await credit.updateDriverCreditSetting({ blockDriverOnNegativeBalance: false, version: 0 });
        expect((await startRide({ rideId: ride._id, captain })).status).toBe('started');
    });

    test('corrida de passageiro já aceita pode prosseguir mesmo com crédito negativo', async () => {
        const captain = await createCaptain();
        await settingsModel.create({ blockDriverOnNegativeBalance: true });
        await walletModel.create({ captainId: captain._id, creditBalance: -1 });
        const ride = await rideModel.create({
            user: new mongoose.Types.ObjectId(), captain: captain._id,
            source: 'passenger_requested', status: 'accepted',
            pickup: 'Origem de teste', destination: 'Destino de teste', fare: 10, vehicleType: 'car',
        });
        expect((await startRide({ rideId: ride._id, captain })).status).toBe('started');
    });

    test('sem configuração permite zero e bloqueia qualquer crédito negativo', async () => {
        const captain = await createCaptain();
        expect(await credit.getDriverCreditSetting()).toEqual({ blockDriverOnNegativeBalance: true, version: 0 });
        await expect(credit.assertDriverCreditAllowed(captain._id)).resolves.toBeUndefined();
        await walletModel.create({ captainId: captain._id, creditBalance: -0.01 });
        await expect(credit.assertDriverCreditAllowed(captain._id)).rejects.toMatchObject({ code: 'DRIVER_CREDIT_BLOCKED', statusCode: 403 });
    });

    test('configuração antiga com tolerância negativa não contorna o bloqueio', async () => {
        const captain = await createCaptain();
        await settingsModel.create({ blockDriverOnNegativeBalance: true, maximumNegativeBalance: -20 });
        await walletModel.create({ captainId: captain._id, creditBalance: -1 });
        await expect(credit.assertDriverCreditAllowed(captain._id)).rejects.toMatchObject({ code: 'DRIVER_CREDIT_BLOCKED' });
    });

    test('desativar libera imediatamente; reativar bloqueia negativos sem atingir aprovação e bloqueios administrativos', async () => {
        await settingsModel.create({ blockDriverOnNegativeBalance: true });
        const negative = await createCaptain({ email: 'negative@test.com', canReceiveRides: false });
        const zero = await createCaptain({ email: 'zero@test.com', canReceiveRides: false });
        const blocked = await createCaptain({ email: 'blocked@test.com', isBlocked: true, canReceiveRides: false });
        const pending = await createCaptain({ email: 'pending@test.com', approvalStatus: 'em_analise', canReceiveRides: false });
        await walletModel.create({ captainId: negative._id, creditBalance: -10 });
        const off = await credit.updateDriverCreditSetting({ blockDriverOnNegativeBalance: false, version: 0 });
        expect(off.blockDriverOnNegativeBalance).toBe(false);
        await expect(credit.assertDriverCreditAllowed(negative._id)).resolves.toBeUndefined();
        expect((await captainModel.findById(negative._id)).canReceiveRides).toBe(true);
        expect((await captainModel.findById(zero._id)).canReceiveRides).toBe(true);
        expect((await captainModel.findById(blocked._id)).canReceiveRides).toBe(false);
        expect((await captainModel.findById(pending._id)).canReceiveRides).toBe(false);
        const on = await credit.updateDriverCreditSetting({ blockDriverOnNegativeBalance: true, version: off.version });
        expect(on.blockDriverOnNegativeBalance).toBe(true);
        expect((await captainModel.findById(negative._id)).canReceiveRides).toBe(false);
        expect((await captainModel.findById(zero._id)).canReceiveRides).toBe(true);
        await expect(credit.assertDriverCreditAllowed(negative._id)).rejects.toMatchObject({ code: 'DRIVER_CREDIT_BLOCKED' });
        expect((await settingsModel.findOne()).maximumNegativeBalance).toBe(0);
    });

    test('duas edições concorrentes não sobrescrevem a regra sem conflito', async () => {
        await settingsModel.create({ blockDriverOnNegativeBalance: true });
        const attempts = await Promise.allSettled([
            credit.updateDriverCreditSetting({ blockDriverOnNegativeBalance: false, version: 0 }),
            credit.updateDriverCreditSetting({ blockDriverOnNegativeBalance: false, version: 0 }),
        ]);
        expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(attempts.find(result => result.status === 'rejected').reason.statusCode).toBe(409);
    });

    test.each(['false', 0, undefined])('recusa valor não booleano %p sem alterar a regra', async value => {
        await settingsModel.create({ blockDriverOnNegativeBalance: true });
        await expect(credit.updateDriverCreditSetting({ blockDriverOnNegativeBalance: value, version: 0 })).rejects.toMatchObject({ statusCode: 400 });
        expect((await credit.getDriverCreditSetting()).blockDriverOnNegativeBalance).toBe(true);
    });

    test('comissão e recarga usam a política atual, inclusive com regra desligada', async () => {
        const captain = await createCaptain();
        await settingsModel.create({ blockDriverOnNegativeBalance: true, maximumNegativeBalance: -20 });
        await walletModel.create({ captainId: captain._id, creditBalance: 0 });
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                await createTransaction({ captainId: captain._id, type: 'commission', amount: 1, description: 'Comissão de teste', session });
            });
        } finally { await session.endSession(); }
        expect((await captainModel.findById(captain._id)).canReceiveRides).toBe(false);
        const setting = await credit.getDriverCreditSetting();
        await credit.updateDriverCreditSetting({ blockDriverOnNegativeBalance: false, version: setting.version });
        await createTransaction({ captainId: captain._id, type: 'commission', amount: 1, description: 'Comissão de teste' });
        expect((await captainModel.findById(captain._id)).canReceiveRides).toBe(true);
        const off = await credit.getDriverCreditSetting();
        await credit.updateDriverCreditSetting({ blockDriverOnNegativeBalance: true, version: off.version });
        await createTransaction({ captainId: captain._id, type: 'recharge', amount: 2, description: 'Recarga de teste' });
        expect((await walletModel.findOne({ captainId: captain._id })).creditBalance).toBe(0);
        expect((await captainModel.findById(captain._id)).canReceiveRides).toBe(true);
    });
});
