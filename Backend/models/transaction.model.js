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
    parcelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'parcel'
    },
    type: {
        type: String,
        required: true,
        enum: ['commission', 'recharge', 'withdraw', 'payout', 'bonus', 'adjustment', 'ride_payment', 'parcel_payment']
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

// Rede de segurança contra pagamento duplicado: no máximo um lançamento de pagamento
// e um de comissão por corrida/encomenda. A guarda de verdade é o findOneAndUpdate
// condicional em confirmPayment*; estes índices cobrem regressões futuras.
//
// Importante: usar $type:'objectId' (não só $exists:true). Em MongoDB, rideId:null
// "$exists" — então um índice parcial com $exists:true ainda indexa null e a 2ª
// comissão de encomenda (sem rideId real) estoura E11000 dup key { rideId:null,
// type:"commission" }. Só ObjectId válido entra no índice.
transactionSchema.index(
    { rideId: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: {
            rideId: { $type: 'objectId' },
            type: { $in: ['ride_payment', 'commission'] },
        },
    }
);
transactionSchema.index(
    { parcelId: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: {
            parcelId: { $type: 'objectId' },
            type: { $in: ['parcel_payment', 'commission'] },
        },
    }
);

module.exports = mongoose.model('transaction', transactionSchema);
