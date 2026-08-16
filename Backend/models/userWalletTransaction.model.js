const mongoose = require('mongoose');

// Ledger imutável da carteira do passageiro. O saldo em user.walletBalance continua
// sendo a leitura rápida; este documento explica cada efeito e participa da mesma
// transação Mongo da corrida.
const userWalletTransactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
    },
    rideId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride',
        required: true,
    },
    type: {
        type: String,
        enum: ['ride_debit', 'ride_refund', 'adjustment'],
        required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    idempotencyKey: { type: String, trim: true },
}, { timestamps: true });

userWalletTransactionSchema.index(
    { rideId: 1, type: 1 },
    { name: 'user_wallet_ride_effect_unique', unique: true }
);
userWalletTransactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('UserWalletTransaction', userWalletTransactionSchema);
