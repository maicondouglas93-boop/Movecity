const mongoose = require('mongoose');


const rideSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        // Corrida presencial (driver_initiated) pode existir sem passageiro cadastrado.
        required: function () {
            return this.source !== 'driver_initiated';
        },
    },
    captain: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
    },
    // Origem da solicitação: passageiro via app vs motorista iniciando presencialmente.
    // driver_initiated NUNCA entra no despacho (findCaptains / new-ride / broadcast).
    source: {
        type: String,
        enum: [ 'passenger_requested', 'driver_initiated' ],
        default: 'passenger_requested',
        index: true,
    },
    // true quando o motorista inicia sem destino e o GPS do fim define o destino.
    destinationPending: {
        type: Boolean,
        default: false,
    },
    pickup: {
        type: String,
        required: true,
    },
    destination: {
        type: String,
        required: function () {
            return !this.destinationPending;
        },
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
        enum: [ 'scheduled', 'requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'finished', 'cancelled' ],
        default: 'requested',
    },
    // Preenchido quando status === 'scheduled'; despacho ocorre perto do horário.
    scheduledAt: {
        type: Date,
        default: null,
        index: true,
    },
    // Momento em que saiu de scheduled → requested (Fase 1 agendamento).
    // Relógio de expire/pending pós-ativação; createdAt permanece o booking original.
    activatedAt: {
        type: Date,
        default: null,
    },
    dispatchAttempts: {
        type: Number,
        default: 0,
    },
    dispatchLastError: {
        type: String,
        default: null,
    },
    // Fase 4 financeiro: cupom/wallet NÃO são liquidados no booking — só na ativação.
    promoCodeScheduled: {
        type: String,
        default: null,
    },
    useWalletScheduled: {
        type: Boolean,
        default: false,
    },
    scheduleFinanceSettledAt: {
        type: Date,
        default: null,
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
    // Auditoria de UX do motorista (2026-08-02, Etapa 6): coordenadas do embarque,
    // resolvidas uma vez no despacho e persistidas aqui — sem isso, o frontend não tinha
    // como calcular "a quantos km você está do passageiro", a informação que mais pesa
    // na decisão de aceitar ou não uma corrida (§2.10 do relatório de UX).
    pickupCoordinates: {
        lat: { type: Number },
        lng: { type: Number },
    },
    destinationCoordinates: {
        lat: { type: Number },
        lng: { type: Number },
    },
    // Origem persistida no momento da criação presencial (GPS do motorista no backend).
    origin: {
        coordinates: { type: [ Number ] }, // [lng, lat]
        address: { type: String },
        timestamp: { type: Date },
    },
    // Como o destino definitivo foi obtido (endereço informado vs GPS ao finalizar).
    destinationMeta: {
        coordinates: { type: [ Number ] }, // [lng, lat]
        timestamp: { type: Date },
        source: {
            type: String,
            enum: [ 'user_provided', 'gps_at_finish' ],
        },
    },
    startedAt: {
        type: Date,
        description: 'Quando a corrida entrou em started — base preferencial do actualTime',
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
    // Bloco H (2026-08-02): promoção aplicada na criação da corrida — finalPrice já vem
    // com o desconto subtraído; estes dois campos guardam o que foi aplicado e por quê,
    // pra auditoria e pra confirmPaymentReceived saber quanto compensar o motorista.
    promotionApplied: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Promotion'
    },
    discountAmount: {
        type: Number,
        default: 0
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
    // Implementação do sistema de cancelamento (2026-08-04): quem cancelou, por quê e
    // quando. Só é gravado quando o status realmente vira 'cancelled' — o motorista
    // "desistindo" antes de iniciar (cancelRideByCaptain) NÃO passa por aqui, porque a
    // corrida não termina, volta pro despacho (ver captainCancellations abaixo).
    cancelledBy: {
        type: String,
        enum: ['passenger', 'captain', 'system'],
    },
    cancellationReason: {
        type: String,
    },
    cancelledAt: {
        type: Date,
    },
    // Histórico de motoristas que desistiram desta corrida ANTES de iniciá-la (volta pro
    // despacho, a corrida em si continua ativa) — diferente de cancelledBy/cancelledAt
    // acima, que só existem numa corrida efetivamente CANCELLED. Sem isso não haveria
    // nenhum registro de "por que o motorista X desistiu", já que o documento é
    // reaproveitado (mesmo _id) para o próximo motorista aceitar.
    captainCancellations: [{
        captain: { type: mongoose.Schema.Types.ObjectId, ref: 'captain' },
        reason: { type: String },
        atStatus: { type: String },
        cancelledAt: { type: Date, default: Date.now },
    }],
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
// SCH-M1 Fase 2: cron de ativação + listagens por janela.
rideSchema.index({ status: 1, scheduledAt: 1 });
rideSchema.index({ status: 1, activatedAt: 1 });

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