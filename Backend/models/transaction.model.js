const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    captainId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
        required: true
    },
    rideId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride'
    },
    type: {
        type: String,
        required: true,
        enum: ['commission', 'recharge', 'withdraw', 'bonus', 'adjustment', 'ride_payment']
    },
    paymentMethod: {
        type: String,
        required: true,
        enum: ['cash', 'pix', 'wallet']
    },
    amount: {
        type: Number,
        required: true
    },
    balanceBefore: {
        type: Number,
        required: true
    },
    balanceAfter: {
        type: Number,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'canceled'],
        default: 'completed'
    }
}, { timestamps: true });

module.exports = mongoose.model('transaction', transactionSchema);
