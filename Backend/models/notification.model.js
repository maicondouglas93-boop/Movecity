const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: false
    },
    captainId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
        required: false
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
        enum: [
            'NEW_RIDE', 'NEW_PARCEL', 'RIDE_ACCEPTED', 'RIDE_STARTED', 'RIDE_FINISHED',
            'RIDE_ARRIVED', 'RIDE_CANCELLED', 'CHAT', 'PAYMENT', 'PROMOTION', 'ADMIN',
            'RECHARGE', 'DOCUMENT',
            'SCHEDULE_CREATED', 'SCHEDULE_ACTIVATED', 'SCHEDULE_NO_DRIVER', 'SCHEDULE_REMINDER',
        ],
        default: 'NEW_RIDE'
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
        default: false
    },
    sentAt: {
        type: Date
    }
}, { timestamps: true });

module.exports = mongoose.model('notification', notificationSchema);
