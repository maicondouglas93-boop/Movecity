const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const refreshTokenModel = require('../models/refreshToken.model');

// Auditoria de autenticação e sessão persistente (2026-08-02).
//
// Estratégia: access token curto (15min) + refresh token de longa duração (365 dias),
// rotativo e revogável. O usuário nunca percebe a renovação; a sessão só termina por
// ação explícita (logout), revogação (bloqueio administrativo) ou detecção de roubo.
//
// Por que 365 dias e não "infinito": um refresh token sem expiração alguma é
// indefensável em segurança. Como cada uso rotaciona e renova a validade, quem abre o
// app com alguma regularidade nunca expira na prática — que é o comportamento pedido.

const ACCESS_TOKEN_TTL = '15m';
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_DAYS = 365;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports.ACCESS_TOKEN_TTL = ACCESS_TOKEN_TTL;
module.exports.ACCESS_TOKEN_TTL_SECONDS = ACCESS_TOKEN_TTL_SECONDS;
module.exports.REFRESH_TOKEN_TTL_DAYS = REFRESH_TOKEN_TTL_DAYS;
module.exports.hashToken = hashToken;

module.exports.generateAccessToken = (userId, extraClaims = {}) => {
    return jwt.sign(
        { _id: userId, ...extraClaims },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_TTL }
    );
};

// Emite um par novo (login). O refresh token cru é devolvido pro chamador entregar ao
// cliente; no banco fica só o hash.
module.exports.issueTokenPair = async ({ userId, userType, extraClaims = {}, ip }) => {
    const accessToken = module.exports.generateAccessToken(userId, extraClaims);

    const refreshToken = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await refreshTokenModel.create({
        tokenHash: hashToken(refreshToken),
        userId,
        userType,
        expiresAt,
        createdByIp: ip
    });

    return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
};

// Troca um refresh token por um par novo, rotacionando (o antigo é marcado como usado e
// aponta pro substituto). Lança erro com `code` legível pro controller decidir a resposta.
//
// Detecção de reuse: se o token apresentado já foi rotacionado (`replacedBy` preenchido)
// ou já revogado, significa que alguém está usando uma cópia antiga — o mais provável é
// roubo. Nesse caso derruba TODAS as sessões daquele usuário, não só esta.
module.exports.rotateRefreshToken = async ({ refreshToken, ip }) => {
    if (!refreshToken) {
        const err = new Error('Refresh token ausente');
        err.code = 'MISSING_REFRESH_TOKEN';
        throw err;
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await refreshTokenModel.findOne({ tokenHash });

    if (!stored) {
        const err = new Error('Sessão inválida');
        err.code = 'INVALID_REFRESH_TOKEN';
        throw err;
    }

    if (stored.revokedAt || stored.replacedBy) {
        await module.exports.revokeAllForUser({
            userId: stored.userId,
            userType: stored.userType,
            reason: 'reuse_detected'
        });
        const err = new Error('Sessão inválida — por segurança, todas as sessões foram encerradas');
        err.code = 'REFRESH_TOKEN_REUSE';
        throw err;
    }

    if (stored.expiresAt < new Date()) {
        const err = new Error('Sessão expirada');
        err.code = 'EXPIRED_REFRESH_TOKEN';
        throw err;
    }

    const newRefreshToken = crypto.randomBytes(48).toString('hex');
    const newHash = hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await refreshTokenModel.create({
        tokenHash: newHash,
        userId: stored.userId,
        userType: stored.userType,
        expiresAt,
        createdByIp: ip
    });

    stored.replacedBy = newHash;
    stored.revokedAt = new Date();
    stored.revokedReason = 'rotated';
    await stored.save();

    return {
        userId: stored.userId,
        userType: stored.userType,
        refreshToken: newRefreshToken,
        refreshTokenExpiresAt: expiresAt
    };
};

module.exports.revokeRefreshToken = async ({ refreshToken, reason = 'logout' }) => {
    if (!refreshToken) return;
    await refreshTokenModel.updateOne(
        { tokenHash: hashToken(refreshToken), revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: reason } }
    );
};

// Usado no logout "de todos os dispositivos", na detecção de reuse, e no bloqueio
// administrativo — sem isto, bloquear um motorista só teria efeito quando o access
// token dele expirasse.
module.exports.revokeAllForUser = async ({ userId, userType, reason = 'revoked' }) => {
    await refreshTokenModel.updateMany(
        { userId, userType, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: reason } }
    );
};

// sameSite 'none' + secure é o que faz o cookie funcionar quando frontend e backend
// estão em domínios diferentes (o caso desta infra: Vercel + Render). Em dev (http,
// localhost) cai pra 'lax', porque 'none' sem secure é rejeitado pelos navegadores.
module.exports.refreshCookieOptions = () => {
    const isProduction = process.env.NODE_ENV === 'production';
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
        path: '/'
    };
};

// clearCookie precisa dos MESMOS atributos de escopo (path/sameSite/secure/httpOnly)
// usados na gravação, senão o navegador não encontra o cookie pra apagar — mas o
// Express avisa (deprecated) se receber maxAge aqui, porque ele já força a expiração.
module.exports.clearCookieOptions = () => {
    const { maxAge, ...rest } = module.exports.refreshCookieOptions();
    return rest;
};
