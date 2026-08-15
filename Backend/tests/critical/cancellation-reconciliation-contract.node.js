const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('reconciliação possui uma chave única por corrida ou encomenda', () => {
    const source = read('models/cancellationReconciliation.model.js');

    assert.match(source, /subjectType/);
    assert.match(source, /subjectId/);
    assert.match(source, /cancellation_reconciliation_subject_unique/);
    assert.match(source, /retry_required/);
    assert.match(source, /external_pending/);
});

test('cancelamento de corrida confirma status e efeitos locais em uma transação', () => {
    const source = read('services/cancellationReconciliation.service.js');

    assert.match(source, /session\.withTransaction/);
    assert.match(source, /walletRefundAmount/);
    assert.match(source, /userModel\.updateOne[\s\S]+session/);
    assert.match(source, /paymentModel\.(?:updateOne|findOneAndUpdate)[\s\S]+session/);
    assert.match(source, /promotionUsageModel\.(?:updateOne|findOneAndUpdate)[\s\S]+reversedAt[\s\S]+session/);
    assert.match(source, /cancellationReconciliationModel\.(?:updateOne|findOneAndUpdate)[\s\S]+session/);
    assert.match(source, /status:\s*'cancelled'/);
});

test('falha de gateway deixa estado recuperável e retry consulta antes de repetir', () => {
    const service = read('services/cancellationReconciliation.service.js');
    const gateway = read('services/asaas.service.js');

    assert.match(service, /CANCELLATION_RETRY_REQUIRED/);
    assert.match(service, /retry_required/);
    assert.match(service, /getPayment/);
    assert.match(service, /refundPayment/);
    assert.match(service, /deletePayment/);
    assert.match(gateway, /payments\/\$\{paymentId\}\/refund/);
    assert.match(gateway, /asaasApi\.delete\(`\/payments\/\$\{paymentId\}`\)/);
    assert.match(service, /const paymentId = payment\?\.gatewayTransactionId/);
    assert.doesNotMatch(service, /gatewayTransactionId\s*\|\|\s*ride\.paymentID/);
});

test('passageiro, sistema e ADM usam o mesmo orquestrador para corrida', () => {
    const ride = read('services/ride.service.js');
    const schedule = read('services/schedule.service.js');
    const admin = read('services/admin.service.js');

    assert.match(ride, /reconcileRideCancellation/);
    assert.match(schedule, /reconcileRideCancellation/);
    assert.match(admin, /cancelRideByAdmin/);
});

test('passageiro, sistema e ADM usam o mesmo orquestrador para encomenda', () => {
    const parcel = read('services/parcel.service.js');
    const schedule = read('services/schedule.service.js');

    assert.match(parcel, /reconcileParcelCancellation/);
    assert.match(schedule, /reconcileParcelCancellation/);
    assert.match(parcel, /adminCancelParcel/);
});

test('uso promocional revertido deixa de consumir limites sem apagar auditoria', () => {
    const usage = read('models/promotionUsage.model.js');
    const service = read('services/promotion.service.js');

    assert.match(usage, /reversedAt/);
    assert.match(usage, /reversalReason/);
    assert.match(service, /reversedAt:\s*null/);
});

test('webhook reconcilia resultado assíncrono do estorno de forma idempotente', () => {
    const webhook = read('controllers/webhook.controller.js');
    const service = read('services/cancellationReconciliation.service.js');

    assert.match(webhook, /PAYMENT_REFUNDED/);
    assert.match(webhook, /PAYMENT_REFUND_DENIED/);
    assert.match(webhook, /handleAsaasRefundEvent/);
    assert.match(service, /gatewayEventIds/);
});
