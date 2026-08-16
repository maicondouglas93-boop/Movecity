const mongoose = require('mongoose');

// Auditoria de autenticação e sessão persistente (2026-08-02): antes, passageiro e
// motorista tinham só um access token de 24h e nenhum mecanismo de renovação — passadas
// 24h o usuário era forçado a logar de novo. Este model é a sessão de longa duração que
// permite renovar silenciosamente.
//
// O token cru NUNCA é gravado: só o hash SHA-256. Um vazamento do banco não entrega
// sessões utilizáveis. `replacedBy` liga a cadeia de rotação, o que permite detectar
// reuso de um token já rotacionado (sinal clássico de token roubado) e derrubar apenas
// a família iniciada pelo mesmo login.
const refreshTokenSchema = new mongoose.Schema({
    tokenHash: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    userType: {
        type: String,
        required: true,
        enum: ['user', 'captain', 'admin']
    },
    // Identifica apenas a cadeia iniciada por um login. Reuso confirmado revoga esta
    // família, sem encerrar sessões legítimas abertas pelo mesmo usuário em outros
    // dispositivos. Documentos antigos recebem o campo na primeira rotação.
    familyId: {
        type: String,
        default: undefined
    },
    expiresAt: {
        type: Date,
        required: true
    },
    revokedAt: {
        type: Date,
        default: null
    },
    // Motivo da revogação — 'logout', 'rotated', 'reuse_detected', 'blocked', 'password_change'.
    // Guardado pra auditoria: dá pra distinguir uma sessão encerrada pelo usuário de uma
    // derrubada por suspeita de roubo.
    revokedReason: {
        type: String,
        default: null
    },
    // Hash do token que substituiu este numa rotação. Se um token com replacedBy
    // preenchido for reapresentado, alguém está usando uma cópia antiga.
    replacedBy: {
        type: String,
        default: null
    },
    createdByIp: {
        type: String
    }
}, { timestamps: true });

refreshTokenSchema.index({ userId: 1, userType: 1 });
refreshTokenSchema.index({ familyId: 1, revokedAt: 1 });
// Limpeza automática: o documento some do banco 30 dias depois de expirar (janela de
// folga pra investigar incidentes antes do registro sumir).
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
