const rechargeModel = require('../models/recharge.model');
const rideModel = require('../models/ride.model');
const walletService = require('../services/wallet.service');
const notificationService = require('../services/notification.service');
const cancellationReconciliationService = require('../services/cancellationReconciliation.service');

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

        const refundEvents = [
            'PAYMENT_REFUNDED',
            'PAYMENT_PARTIALLY_REFUNDED',
            'PAYMENT_REFUND_IN_PROGRESS',
            'PAYMENT_REFUND_DENIED',
        ];
        if (refundEvents.includes(event.event)) {
            const handled = await cancellationReconciliationService.handleAsaasRefundEvent({
                eventId: event.id,
                eventName: event.event,
                payment: event.payment,
            });
            if (handled) {
                return res.status(200).send('Cancellation refund reconciled');
            }
            if (event.event === 'PAYMENT_REFUND_DENIED') {
                notificationService
                    .sendPaymentProblemAlert(`Estorno ${event.payment?.id || 'sem id'} foi recusado pelo Asaas.`)
                    .catch(console.error);
            }
            return res.status(200).send('Refund event not linked to cancellation');
        }

        if (event.event === 'PAYMENT_RECEIVED' || event.event === 'PAYMENT_CONFIRMED') {
            const paymentId = event.payment.id;
            
            // Check if it's a recharge
            const recharge = await rechargeModel.findOne({ asaasInvoiceId: paymentId });
            
            if (recharge) {
                if (recharge.status === 'pending') {
                    recharge.status = 'paid';
                    await recharge.save();
                    
                    // Credit driver wallet (sem rideId — null colidia no índice único parcial)
                    await walletService.createTransaction({
                        captainId: recharge.captainId,
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

        // Fase 7 da correção do sistema de push (2026-08-02): antes, esses eventos
        // simplesmente caíam no "Event ignored" abaixo — uma recarga ou pagamento
        // recusado/vencido nunca chegava ao conhecimento de ninguém do time. Só avisa
        // (não muda nenhum estado além do que já é registrado no Asaas).
        if (event.event === 'PAYMENT_OVERDUE' || event.event === 'PAYMENT_DECLINED') {
            const paymentId = event.payment?.id;
            const recharge = await rechargeModel.findOne({ asaasInvoiceId: paymentId });
            const description = recharge
                ? `Recarga ${paymentId} de um motorista foi ${event.event === 'PAYMENT_OVERDUE' ? 'vencida' : 'recusada'} pelo Asaas.`
                : `Pagamento ${paymentId} foi ${event.event === 'PAYMENT_OVERDUE' ? 'vencido' : 'recusado'} pelo Asaas.`;
            notificationService.sendPaymentProblemAlert(description).catch(console.error);
            return res.status(200).send('Payment problem acknowledged');
        }

        res.status(200).send('Event ignored');
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).send('Internal server error');
    }
};
