const mongoose = require('mongoose');
const { ACTIVE_PAYOUT_STATUSES } = require('../config/payoutPolicy');

const payoutSchema = new mongoose.Schema({
    captainId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['requested', 'in_analysis', 'approved', 'processing', 'paid', 'rejected'],
        default: 'requested'
    },
    bankDetailsSnapshot: {
        pixKey: String,
        bankName: String,
        bankAgency: String,
        bankAccount: String,
        accountType: String
    },
    adminId: {
        type: String // Registra o Admin que aprovou
    },
    operatorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdminUser'
    },
    paidAt: {
        type: Date
    },
    receiptUrl: {
        type: String
    },
    reason: {
        type: String // Motivo de rejeição ou observações
    },
    transactionId: {
        type: String // ID no gateway de pagamento
    },
    gateway: {
        type: String, // asaas, iugu, etc
        default: 'manual'
    },
    notes: {
        type: String
    }
}, { timestamps: true });

// Auditoria pós-plano (2026-08-16, COR-3005): requestPayout fazia check-then-create
// (findOne + create) fora de transação, sem constraint nenhuma no banco — duas
// requisições simultâneas do mesmo motorista podiam passar pelo findOne antes de
// qualquer create existir e gerar dois payouts pro mesmo saldo pendente. Auditoria
// de produção confirmou zero payouts/duplicatas existentes antes deste índice (ver
// scripts/audit-payout-duplicates.js). A segunda tentativa concorrente vira E11000,
// tratado em wallet.service.js com a mesma mensagem amigável do pré-check.
payoutSchema.index(
    { captainId: 1 },
    {
        name: 'captain_active_payout_unique',
        unique: true,
        partialFilterExpression: { status: { $in: ACTIVE_PAYOUT_STATUSES } },
    }
);

module.exports = mongoose.model('payout', payoutSchema);
