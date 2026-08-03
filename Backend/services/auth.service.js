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

// Auditoria de persistência de login (2026-08-03): janela de tolerância a reuso — ver
// docs/plans/2026-08-03-auditoria-persistencia-login.md para a investigação completa.
//
// Sem isto, duas requisições legítimas do MESMO usuário renovando quase ao mesmo tempo
// (duas abas abertas, ou vários componentes buscando dados assim que o app volta do
// segundo plano depois do access token de 15min expirar) derrubavam a sessão inteira: a
// segunda a chegar via encontrava o token já rotacionado pela primeira, e a detecção de
// reuse tratava isso como roubo — revogando inclusive o token que a primeira aba tinha
// acabado de receber legitimamente. Confirmado empiricamente antes da correção.
//
// Trade-off de segurança, deliberado e documentado: um token reapresentado dentro desta
// janela depois de já ter sido rotacionado deixa de derrubar a sessão inteira — em vez
// disso, gera mais um elo na mesma cadeia de rotação (o servidor nunca guarda o token em
// texto claro, só o hash, então não há como devolver de volta o mesmo token que a outra
// aba já recebeu). Fora da janela, o comportamento de antes continua idêntico: reuso é
// tratado como roubo e derruba tudo. Mesmo padrão recomendado por implementações de
// referência de rotação de refresh token (Auth0, OIDC) para tolerar exatamente esta
// concorrência sem abrir mão de detectar reuso de verdade.
const REUSE_GRACE_MS = 30 * 1000;

// Segue a cadeia de rotação a partir de um token já substituído até achar o elo
// atualmente válido. Devolve `null` se a cadeia estiver cortada (um elo intermediário
// foi revogado por outro motivo, ex: logout explícito no meio da janela) — nesse caso
// não há elo seguro pra continuar, e quem chamou deve tratar como reuso de verdade.
async function walkToCurrent(stored) {
    let current = stored;
    const seen = new Set([current.tokenHash]);
    while (current.replacedBy) {
        if (seen.has(current.replacedBy)) return null; // ciclo — nunca deveria existir
        seen.add(current.replacedBy);
        const next = await refreshTokenModel.findOne({ tokenHash: current.replacedBy });
        if (!next) return null;
        if (next.revokedAt && !next.replacedBy) return null; // revogado sem suceder ninguém (ex: logout)
        current = next;
    }
    return current;
}

// Troca um refresh token por um par novo, rotacionando (o antigo é marcado como usado e
// aponta pro substituto). Lança erro com `code` legível pro controller decidir a resposta.
module.exports.rotateRefreshToken = async ({ refreshToken, ip }) => {
    if (!refreshToken) {
        const err = new Error('Refresh token ausente');
        err.code = 'MISSING_REFRESH_TOKEN';
        throw err;
    }

    const tokenHash = hashToken(refreshToken);
    let stored = await refreshTokenModel.findOne({ tokenHash });

    if (!stored) {
        const err = new Error('Sessão inválida');
        err.code = 'INVALID_REFRESH_TOKEN';
        throw err;
    }

    if (stored.revokedAt || stored.replacedBy) {
        // A janela só vale para revogação por ROTAÇÃO (`replacedBy` preenchido — existe
        // um sucessor de verdade pra seguir). Logout, bloqueio administrativo e reuso já
        // detectado revogam sem definir `replacedBy` — são intencionais e definitivos,
        // nunca devem ganhar tolerância, não importa o quão recentes.
        const withinGrace = stored.replacedBy && stored.revokedAt
            && (Date.now() - stored.revokedAt.getTime()) < REUSE_GRACE_MS;
        const current = withinGrace ? await walkToCurrent(stored) : null;

        if (!current) {
            await module.exports.revokeAllForUser({
                userId: stored.userId,
                userType: stored.userType,
                reason: 'reuse_detected'
            });
            const err = new Error('Sessão inválida — por segurança, todas as sessões foram encerradas');
            err.code = 'REFRESH_TOKEN_REUSE';
            throw err;
        }

        // Dentro da janela e a cadeia leva a um elo vivo: rotaciona a partir dele, como
        // se fosse o token apresentado — a outra aba mantém o que já tinha, esta ganha
        // seu próprio elo novo.
        stored = current;
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
