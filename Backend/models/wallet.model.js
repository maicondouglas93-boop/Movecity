const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
    captainId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
        required: true,
        unique: true
    },
    creditBalance: {
        type: Number,
        default: 0
    },
    pendingBalance: {
        type: Number,
        default: 0
    },
    totalEarned: {
        type: Number,
        default: 0
    },
    totalCommissionPaid: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = mongoose.model('wallet', walletSchema);
