const rechargeModel = require('../models/recharge.model');
const rideModel = require('../models/ride.model');
const walletService = require('../services/wallet.service');

module.exports.handleAsaasWebhook = async (req, res) => {
    try {
        // Sem essa validação, qualquer POST externo com um paymentId/asaasInvoiceId
        // conhecido creditava carteira ou marcava corrida como paga (M11 na auditoria).
        // O Asaas reenvia de volta o token configurado no painel no header abaixo.
        const receivedToken = req.headers['asaas-access-token'];
        const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
        if (!expectedToken || receivedToken !== expectedToken) {
            console.warn('[Webhook Asaas] Requisição rejeitada: token ausente ou inválido.');
            return res.status(401).send('Unauthorized');
        }

        const event = req.body;

        if (!event || !event.event) {
            return res.status(400).send('Invalid webhook payload');
        }

        if (event.event === 'PAYMENT_RECEIVED' || event.event === 'PAYMENT_CONFIRMED') {
            const paymentId = event.payment.id;
            
            // Check if it's a recharge
            const recharge = await rechargeModel.findOne({ asaasInvoiceId: paymentId });
            
            if (recharge) {
                if (recharge.status === 'pending') {
                    recharge.status = 'paid';
                    await recharge.save();
                    
                    // Credit driver wallet
                    await walletService.createTransaction({
                        captainId: recharge.captainId,
                        rideId: null,
                        type: 'recharge',
                        paymentMethod: recharge.method.replace('asaas_', ''), // pix, boleto, card
                        amount: recharge.amount,
                        description: `Recarga via Asaas (${recharge.method})`,
                        reason: `Webhook Asaas ${paymentId}`
                    });
                }
                return res.status(200).send('Recharge processed');
            }

            // Check if it's a ride payment
            const ride = await rideModel.findOne({ paymentID: paymentId });
            if (ride) {
                if (ride.paymentStatus !== 'paid') {
                    // Update ride payment status
                    await rideModel.findByIdAndUpdate(ride._id, { paymentStatus: 'paid' });
                    
                    // The driver's wallet pendingBalance update will be handled either here or in confirmPaymentReceived
                    // Typically, if payment is async (Pix/Boleto for ride), we confirm it here.
                    // But if it's credit card, we usually do it synchronously or via webhook.
                }
                return res.status(200).send('Ride payment processed');
            }

            return res.status(200).send('Payment not linked to any local entity');
        }

        res.status(200).send('Event ignored');
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).send('Internal server error');
    }
};
