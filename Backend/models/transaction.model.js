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
        enum: ['commission', 'recharge', 'withdraw', 'payout', 'bonus', 'adjustment', 'ride_payment']
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'pix', 'wallet', 'card']
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
    reason: {
        type: String, // Obrigatório para ajustes manuais
    },
    adminId: {
        type: String // Registra o Admin que fez a movimentação manual
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'canceled'],
        default: 'completed'
    }
}, { timestamps: true });

// Rede de segurança contra pagamento duplicado: no máximo um lançamento 'ride_payment'
// e um 'commission' por corrida. A guarda de verdade é o findOneAndUpdate condicional
// em confirmPaymentReceived (ride.service.js); este índice existe para o caso de uma
// regressão futura reintroduzir um caminho que tente gravar duas vezes — o Mongo recusa
// a segunda escrita em vez de deixar a inconsistência silenciosa.
transactionSchema.index(
    { rideId: 1, type: 1 },
    { unique: true, partialFilterExpression: { type: { $in: ['ride_payment', 'commission'] } } }
);

module.exports = mongoose.model('transaction', transactionSchema);
