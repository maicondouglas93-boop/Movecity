const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: false,
        index: true,
    },
    captainId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
        required: false,
        index: true,
    },
    // passenger | driver | admin — destinatário lógico da central in-app
    recipientType: {
        type: String,
        enum: ['passenger', 'driver', 'admin', null],
        default: null,
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    message: {
        type: String,
        required: true
    },
    type: {
        // RIDE_ARRIVED, RIDE_CANCELLED, CHAT e PAYMENT adicionados na Fase 5 da correção
        // do sistema de push (2026-08-02) — motorista chegou, corrida cancelada, chat com
        // app fechado, e pagamento confirmado passam a gerar push de verdade.
        // DOCUMENT adicionado na simplificação do cadastro do motorista (2026-08-04):
        // cobre prazo de documentação (registro/lembrete/expiração) e aprovação/rejeição
        // de documento — mesma granularidade grossa já usada por PAYMENT/RECHARGE
        // (o título/mensagem distingue o cenário específico).
        type: String,
        // NEW_PARCEL: oferta de encomenda ao motorista (mesmo canal FCM de NEW_RIDE).
        // Sem este valor no enum, Notification.create rejeitava e o push nunca saía.
        // SCHEDULE_*: agendamento (Fase 3) — tipos próprios para analytics (não reusar RIDE_CANCELLED).
        // COUPON / SYSTEM / ALERT: tipos da central de notificações in-app.
        enum: [
            'NEW_RIDE', 'NEW_PARCEL', 'RIDE_ACCEPTED', 'RIDE_STARTED', 'RIDE_FINISHED',
            'RIDE_ARRIVED', 'RIDE_CANCELLED', 'RIDE_REMINDER', 'CHAT', 'PAYMENT', 'PROMOTION', 'ADMIN',
            'RECHARGE', 'DOCUMENT',
            'SCHEDULE_CREATED', 'SCHEDULE_ACTIVATED', 'SCHEDULE_NO_DRIVER', 'SCHEDULE_REMINDER',
            'COUPON', 'SYSTEM', 'ALERT',
        ],
        default: 'NEW_RIDE'
    },
    // Categorias da central (filtro UX): ride, parcel, schedule, promotion, coupon,
    // admin, payment, system, alert
    category: {
        type: String,
        enum: ['ride', 'parcel', 'schedule', 'promotion', 'coupon', 'admin', 'payment', 'system', 'alert'],
        default: 'system',
        index: true,
    },
    priority: {
        type: String,
        enum: ['low', 'normal', 'high', 'urgent'],
        default: 'normal',
    },
    icon: {
        type: String,
        default: '🔔',
    },
    // Rota relativa ou deep link ao clicar (ex.: /riding, /captain-wallet)
    action: {
        type: String,
        default: null,
    },
    referenceId: {
        type: String,
        default: null,
        index: true,
    },
    referenceType: {
        type: String,
        enum: ['ride', 'parcel', 'transaction', 'coupon', 'campaign', 'schedule', null],
        default: null,
    },
    origin: {
        type: String,
        enum: ['system', 'admin', 'campaign', 'payment', 'chat', 'schedule'],
        default: 'system',
    },
    targetAudience: {
        // 'admins' adicionado na Fase 7 (canal de push para o painel administrativo).
        type: String,
        enum: ['all', 'passengers', 'drivers', 'admins', 'specific'],
        default: 'specific'
    },
    status: {
        // M4 da auditoria de push (2026-08-02): 'sending' é gravado antes de tentar o
        // envio de verdade — sem esse estado intermediário, o histórico não distinguia
        // "ainda tentando" de "confirmadamente entregue" (ver notificationDispatcher.
        // service.js: recordAndSend).
        type: String,
        enum: ['draft', 'sending', 'sent', 'failed'],
        default: 'draft'
    },
    read: {
        type: Boolean,
        default: false,
        index: true,
    },
    readAt: {
        type: Date,
        default: null,
    },
    // Quando o usuário abre a central, o badge zera sem marcar tudo como lido.
    // Guardamos a última vez que o contador foi "visto" por recipient — opcionalmente
    // via endpoint dedicado; por padrão o contador usa só `read:false`.
    badgeSeenAt: {
        type: Date,
        default: null,
    },
    sentAt: {
        type: Date
    },
    // Idempotência de ofertas: uma chave por motorista + serviço impede que cron,
    // redispatch ou múltiplas instâncias enviem o mesmo push mais de uma vez.
    dedupeKey: {
        type: String,
        default: null,
    },
    // Campanha/admin que originou o envio (métricas entregue/lida)
    campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'NotificationCampaign',
        default: null,
    },
}, { timestamps: true });

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ captainId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ captainId: 1, read: 1, createdAt: -1 });
notificationSchema.index(
    { dedupeKey: 1 },
    {
        unique: true,
        partialFilterExpression: { dedupeKey: { $type: 'string' } },
    }
);

module.exports = mongoose.model('notification', notificationSchema);
