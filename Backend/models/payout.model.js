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
        enum: ['processing', 'paid', 'failed', 'cancelled'],
        default: 'processing'
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
    paidAt: {
        type: Date
    },
    receipt: {
        type: String
    },
    notes: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model('payout', payoutSchema);
