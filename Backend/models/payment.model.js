const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    rideId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        // Opcional em corrida presencial sem passageiro cadastrado no app.
        required: false,
    },
    amount: {
        type: Number,
        required: true
    },
    method: {
        type: String,
        enum: ['pix', 'cash', 'card', 'carteira'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'failed', 'refund_pending', 'refunded', 'cancelled'],
        default: 'pending'
    },
    gatewayTransactionId: {
        type: String
    },
    gateway: {
        type: String
    }
}, { timestamps: true });

paymentSchema.index(
    { rideId: 1 },
    { name: 'ride_payment_unique', unique: true }
);

module.exports = mongoose.model('payment', paymentSchema);
