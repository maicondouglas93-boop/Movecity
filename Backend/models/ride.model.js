const mongoose = require('mongoose');


const rideSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    captain: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
    },
    pickup: {
        type: String,
        required: true,
    },
    destination: {
        type: String,
        required: true,
    },
    fare: {
        type: Number,
        required: true,
    },
    vehicleType: {
        // Corresponde a vehicleCategory.name. Não é mais um enum fixo: a validade é
        // garantida em runtime pelo PricingEngine (categoria precisa existir e estar ativa).
        type: String,
        required: true
    },

    status: {
        type: String,
        enum: [ 'requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'finished', 'cancelled' ],
        default: 'requested',
    },

    duration: {
        type: Number, // Deprecated, but keeping for compatibility if needed. Better to use estimatedTime/actualTime
    }, 
    distance: {
        type: Number, // Deprecated, keeping for compatibility
    },

    estimatedDistance: {
        type: Number, // meters
    },
    estimatedTime: {
        type: Number, // seconds
    },
    estimatedPriceMin: {
        type: Number,
    },
    estimatedPriceMax: {
        type: Number,
    },
    actualDistance: {
        type: Number,
        default: 0
    },
    lastLocation: {
        lat: Number,
        lng: Number
    },
    actualTime: {
        type: Number,
    },
    finalPrice: {
        type: Number,
    },
    arrivedAt: {
        type: Date,
        description: "Quando o status virou 'arrived' — usado para calcular taxa de espera excedente"
    },
    cancellationFeeCharged: {
        type: Number,
        default: 0,
        description: "Taxa de cancelamento (tariffSetting.cancellationFee) quando o passageiro cancela com motorista já a caminho"
    },
    waitTimeFeeCharged: {
        type: Number,
        default: 0,
        description: "Taxa de espera excedente (tariffSetting.perMinuteWaitFee) além de maxFreeWaitTime, somada ao finalPrice"
    },
    commissionPercent: {
        type: Number,
    },
    commissionAmount: {
        type: Number,
    },
    fareBreakdown: {
        type: Object,
        description: "Detalhamento de todos os fatores de preço (base, tempo, distância, chuva, etc)"
    },
    pricingSnapshot: {
        type: Object,
        description: "Snapshot da configuração de tarifa/comissão (tariffSetting, globalSetting, categoria de veículo, regras ativas) vigente no momento em que a corrida foi solicitada — P2.2 da auditoria de concorrência, 2026-08-02. endRide recalcula o preço final a partir DESTE snapshot, não da configuração atual, pra uma mudança de tarifa/comissão feita pelo admin durante a corrida não afetar o valor já contratado. Ausente em corridas criadas antes desta mudança."
    },

    paymentID: {
        type: String,
    },
    paymentStatus: {
        type: String,
        enum: [ 'pending', 'paid', 'failed', 'refunded' ],
        default: 'pending',
    },
    paymentMethod: {
        type: String,
        enum: [ 'card', 'cash', 'pix', 'carteira' ],
        default: 'cash',
    },
    walletAmountUsed: {
        type: Number,
        default: 0
    },
    optionals: [{
        type: {
            type: String
        },
        price: Number
    }],
    observation: {
        type: String
    },
    requestFemaleDriver: {
        type: Boolean,
        default: false
    },
    paymentGateway: {
        type: String,
        default: 'asaas'
    },
    gatewayTransactionId: {
        type: String
    },
    orderId: {
        type: String,
    },
    signature: {
        type: String,
    },

    otp: {
        type: String,
        select: false,
        required: true,
    },
}, { timestamps: true });

// Índices de Performance
rideSchema.index({ status: 1 });
rideSchema.index({ captain: 1 });
rideSchema.index({ user: 1 });
rideSchema.index({ createdAt: -1 });

// Um motorista só pode ter uma corrida ativa por vez (C2 da auditoria de concorrência,
// 2026-08-02) — antes, nada impedia aceitar duas corridas simultâneas: o
// findOneAndUpdate atômico do aceite garante que só um motorista "ganha" cada corrida
// individualmente, mas não olhava se esse motorista já tinha outra corrida em aberto.
// Esta é a garantia no nível do banco: a segunda tentativa de gravar `captain` num
// status ativo enquanto já existe outro documento igual vira erro de chave duplicada
// (tratado em acceptRideAtomic).
rideSchema.index(
    { captain: 1 },
    {
        name: 'captain_active_ride_unique',
        unique: true,
        partialFilterExpression: { status: { $in: ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started'] } }
    }
);

module.exports = mongoose.model('ride', rideSchema);