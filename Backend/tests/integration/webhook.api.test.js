const request = require('supertest');
const app = require('../../app');
const rechargeModel = require('../../models/recharge.model');
const walletModel = require('../../models/wallet.model');
const captainModel = require('../../models/captain.model');
const mongoose = require('mongoose');

// Regression coverage for M11: o webhook do Asaas processava qualquer POST sem checar
// se ele realmente veio do Asaas, permitindo creditar carteira de motorista com um
// paymentId adivinhado.
describe('Webhook API — POST /webhooks/asaas', () => {
    const originalToken = process.env.ASAAS_WEBHOOK_TOKEN;

    beforeAll(() => {
        process.env.ASAAS_WEBHOOK_TOKEN = 'test-webhook-secret';
    });

    afterAll(() => {
        process.env.ASAAS_WEBHOOK_TOKEN = originalToken;
    });

    it('should reject requests without the access token', async () => {
        const res = await request(app)
            .post('/webhooks/asaas')
            .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_fake123' } });

        expect(res.statusCode).toBe(401);
    });

    it('should reject requests with a wrong access token', async () => {
        const res = await request(app)
            .post('/webhooks/asaas')
            .set('asaas-access-token', 'wrong-token')
            .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_fake123' } });

        expect(res.statusCode).toBe(401);
    });

    it('should process a valid recharge event when the token matches', async () => {
        const captainId = new mongoose.Types.ObjectId();
        await captainModel.create({
            _id: captainId,
            fullname: { firstname: 'Test', lastname: 'Driver' },
            email: 'webhook-driver@test.com',
            phone: '+5511999999999',
            password: 'password123',
            vehicle: { color: 'black', plate: 'TEST9999', capacity: 4, vehicleType: 'car' }
        });

        await rechargeModel.create({
            captainId,
            amount: 50,
            method: 'asaas_pix',
            status: 'pending',
            asaasInvoiceId: 'pay_valid123'
        });

        const res = await request(app)
            .post('/webhooks/asaas')
            .set('asaas-access-token', 'test-webhook-secret')
            .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_valid123' } });

        expect(res.statusCode).toBe(200);

        const recharge = await rechargeModel.findOne({ asaasInvoiceId: 'pay_valid123' });
        expect(recharge.status).toBe('paid');

        const wallet = await walletModel.findOne({ captainId });
        expect(wallet.creditBalance).toBe(50);
    });
});
