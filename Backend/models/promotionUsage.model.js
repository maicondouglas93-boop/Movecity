const mongoose = require('mongoose');

// Auditoria do painel administrativo (2026-08-02, Bloco H): não existia nenhum jeito de
// contar quantas vezes um usuário/o total/o dia já usou uma promoção — usagePerUserLimit,
// usagePerDayLimit e globalUsageLimit eram salvos no formulário do admin e nunca checados
// por nada, porque nada aplicava promoção nenhuma. Este histórico é o que torna esses
// limites checáveis de verdade.
const promotionUsageSchema = new mongoose.Schema({
    promotionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Promotion',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    rideId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride',
        required: true
    },
    discountAmount: {
        type: Number,
        required: true
    },
    // Reversão preserva a trilha: uso cancelado deixa de consumir limites, mas o
    // documento original continua disponível para auditoria e reconciliação.
    reversedAt: { type: Date, default: null },
    reversalReason: String,
    cancellationReconciliationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CancellationReconciliation',
    },
}, { timestamps: true });

promotionUsageSchema.index({ promotionId: 1, userId: 1 });
promotionUsageSchema.index({ promotionId: 1, createdAt: 1 });

module.exports = mongoose.model('PromotionUsage', promotionUsageSchema);
