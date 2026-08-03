const mongoose = require('mongoose');

const notificationTokenSchema = new mongoose.Schema({
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
    // Fase 7 da correção do sistema de push (2026-08-02): canal de push para o painel
    // administrativo — mesma tabela, mesmo tokenRegistry, só mais um dono possível.
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdminUser',
        required: false
    },
    device: {
        type: String,
        default: 'web'
    },
    token: {
        type: String,
        required: true,
        unique: true
    }
}, { timestamps: true });

const NotificationToken = mongoose.model('NotificationToken', notificationTokenSchema);

module.exports = NotificationToken;
