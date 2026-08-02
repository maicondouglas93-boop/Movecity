const mongoose = require('mongoose');

const blacklistTokenSchema = new mongoose.Schema({
    token: {
        type: String,
        required: true,
        unique: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        // Auditoria de sessão (2026-08-02, achado B3): o TTL precisa ser >= a validade
        // do access token. Antes eram 24h fixos, casando por coincidência com o token
        // de 24h da época; com o access token agora em 15min, manter 24h aqui só
        // acumularia registros inúteis — e, mais grave, se alguém aumentasse a validade
        // do token sem mexer aqui, um token deslogado voltaria a ser aceito quando o
        // registro de blacklist expirasse antes dele. A folga de 2x cobre skew de relógio.
        expires: 30 * 60 // 30 minutos = 2x a validade do access token
    }
});

module.exports = mongoose.model('BlacklistToken', blacklistTokenSchema);