const mongoose = require('mongoose');

// Uma reconciliação por serviço cancelado. O documento é também o ledger imutável
// dos valores calculados; status/erro podem evoluir, mas os efeitos confirmados nunca
// são apagados nem recriados em retry.
const cancellationReconciliationSchema = new mongoose.Schema({
    subjectType: {
        type: String,
        enum: ['ride', 'parcel'],
        required: true,
    },
    subjectId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    actor: {
        type: String,
        enum: ['passenger', 'captain', 'admin', 'system'],
        required: true,
    },
    requestedBy: String,
    reason: String,
    status: {
        type: String,
        enum: ['processing', 'external_pending', 'retry_required', 'completed'],
        required: true,
        default: 'processing',
    },
    attempts: { type: Number, default: 0 },
    leaseUntil: Date,
    walletRefundAmount: { type: Number, default: 0, min: 0 },
    cancellationFeeAmount: { type: Number, default: 0, min: 0 },
    promotionReversed: { type: Boolean, default: false },
    promotionDiscountAmount: { type: Number, default: 0, min: 0 },
    paymentEffect: {
        type: String,
        enum: ['none', 'cancelled', 'refunded', 'external_refund_pending', 'external_charge_deleted'],
        default: 'none',
    },
    gateway: {
        name: String,
        paymentId: String,
        action: { type: String, enum: ['refund', 'delete'] },
        refundStatus: String,
        refundValue: Number,
        receiptUrl: String,
        requestedAt: Date,
        respondedAt: Date,
    },
    gatewayEventIds: { type: [String], default: [], select: false },
    lastError: String,
    completedAt: Date,
}, { timestamps: true });

cancellationReconciliationSchema.index(
    { subjectType: 1, subjectId: 1 },
    { name: 'cancellation_reconciliation_subject_unique', unique: true }
);
cancellationReconciliationSchema.index({ status: 1, updatedAt: 1 });

module.exports = mongoose.model('CancellationReconciliation', cancellationReconciliationSchema);
