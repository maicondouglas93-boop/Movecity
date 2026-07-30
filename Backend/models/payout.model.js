const mongoose = require('mongoose');

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
        ref: 'adminUser'
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

module.exports = mongoose.model('payout', payoutSchema);
