const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
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
const TOKEN_VERSION = 2;
const TOKEN_ISSUER = process.env.JWT_ISSUER || 'movecity-api';
const ACTOR_TYPES = ['user', 'captain', 'admin'];
const AUDIENCE_BY_ACTOR = Object.freeze({
    user: 'movecity:user',
    captain: 'movecity:captain',
    admin: 'movecity:admin',
});
const SHARE_AUDIENCE = 'movecity:ride-share';
const RESERVED_CLAIMS = new Set([
    '_id', 'sub', 'iss', 'aud', 'iat', 'exp', 'nbf', 'jti',
    'actorType', 'tokenType', 'ver',
]);
const tokenPolicyMetrics = {
    acceptedAccess: 0,
    acceptedShare: 0,
    lastAcceptedAt: null,
    refreshRotated: 0,
    refreshGraceAccessOnly: 0,
    refreshReuseDetected: 0,
    refreshConflicts: 0,
};

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports.ACCESS_TOKEN_TTL = ACCESS_TOKEN_TTL;
module.exports.ACCESS_TOKEN_TTL_SECONDS = ACCESS_TOKEN_TTL_SECONDS;
module.exports.REFRESH_TOKEN_TTL_DAYS = REFRESH_TOKEN_TTL_DAYS;
module.exports.TOKEN_VERSION = TOKEN_VERSION;
module.exports.TOKEN_ISSUER = TOKEN_ISSUER;
module.exports.AUDIENCE_BY_ACTOR = AUDIENCE_BY_ACTOR;
module.exports.hashToken = hashToken;
module.exports.getTokenPolicyMetrics = () => ({ ...tokenPolicyMetrics });

function tokenError(code, message = code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function assertActorType(actorType) {
    if (!ACTOR_TYPES.includes(actorType)) {
        throw tokenError('INVALID_TOKEN_ACTOR', 'Ator de autenticação inválido');
    }
    return actorType;
}

function secretFor(actorType, purpose = 'access') {
    if (purpose === 'share') {
        if (process.env.JWT_SHARE_SECRET) return process.env.JWT_SHARE_SECRET;
        if (process.env.NODE_ENV === 'production') {
            throw tokenError('TOKEN_SECRET_NOT_CONFIGURED', 'JWT_SHARE_SECRET obrigatório em produção');
        }
        return process.env.JWT_SECRET;
    }
    if (actorType === 'admin') {
        if (process.env.JWT_ADMIN_SECRET) return process.env.JWT_ADMIN_SECRET;
        if (process.env.NODE_ENV === 'production') {
            throw tokenError('TOKEN_SECRET_NOT_CONFIGURED', 'JWT_ADMIN_SECRET obrigatório em produção');
        }
        return process.env.JWT_SECRET;
    }
    return process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
}

function safeExtraClaims(extraClaims = {}) {
    return Object.fromEntries(
        Object.entries(extraClaims).filter(([key]) => !RESERVED_CLAIMS.has(key))
    );
}

function normalizedExpectedActors(expectedActorTypes) {
    const actors = Array.isArray(expectedActorTypes) ? expectedActorTypes : [expectedActorTypes];
    if (!actors.length) throw tokenError('INVALID_TOKEN_ACTOR');
    actors.forEach(assertActorType);
    return actors;
}

function legacyTokensEnabled() {
    if (process.env.JWT_ACCEPT_LEGACY_TOKENS !== 'true') return false;
    const cutoff = new Date(process.env.JWT_LEGACY_ACCEPT_UNTIL || 'invalid');
    return Number.isFinite(cutoff.getTime()) && cutoff.getTime() > Date.now();
}

function recordLegacyAcceptance(purpose, expectedActors = []) {
    if (purpose === 'share') tokenPolicyMetrics.acceptedShare += 1;
    else tokenPolicyMetrics.acceptedAccess += 1;
    tokenPolicyMetrics.lastAcceptedAt = new Date().toISOString();
    console.warn(JSON.stringify({
        tag: 'AUTH_LEGACY_TOKEN_ACCEPTED',
        purpose,
        expectedActors,
        at: tokenPolicyMetrics.lastAcceptedAt,
    }));
}

function recordRefreshEvent(metric, tag, actorType) {
    tokenPolicyMetrics[metric] += 1;
    if (tag) {
        console.warn(JSON.stringify({ tag, actorType, at: new Date().toISOString() }));
    }
}

module.exports.generateAccessToken = (userId, userType, extraClaims = {}) => {
    const actorType = assertActorType(userType);
    const subjectId = String(userId);
    return jwt.sign(
        {
            _id: subjectId,
            actorType,
            tokenType: 'access',
            ver: TOKEN_VERSION,
            ...safeExtraClaims(extraClaims),
        },
        secretFor(actorType),
        {
            algorithm: 'HS256',
            expiresIn: ACCESS_TOKEN_TTL,
            subject: subjectId,
            issuer: TOKEN_ISSUER,
            audience: AUDIENCE_BY_ACTOR[actorType],
            jwtid: crypto.randomUUID(),
        }
    );
};

module.exports.verifyAccessToken = (token, expectedActorTypes) => {
    const expectedActors = normalizedExpectedActors(expectedActorTypes);
    const untrusted = jwt.decode(token);
    const looksLikeV2 = untrusted?.ver === TOKEN_VERSION
        || untrusted?.actorType
        || untrusted?.tokenType;

    if (looksLikeV2) {
        const actorType = assertActorType(untrusted?.actorType);
        if (!expectedActors.includes(actorType)) {
            throw tokenError('TOKEN_ACTOR_MISMATCH', 'Token emitido para outro ator');
        }
        const decoded = jwt.verify(token, secretFor(actorType), {
            algorithms: ['HS256'],
            issuer: TOKEN_ISSUER,
            audience: AUDIENCE_BY_ACTOR[actorType],
        });
        if (decoded.ver !== TOKEN_VERSION || decoded.tokenType !== 'access') {
            throw tokenError('TOKEN_PURPOSE_MISMATCH', 'Finalidade do token inválida');
        }
        if (!decoded.sub || String(decoded.sub) !== String(decoded._id)) {
            throw tokenError('TOKEN_SUBJECT_MISMATCH', 'Subject do token inválido');
        }
        return {
            ...decoded,
            subjectId: String(decoded.sub),
            actorType,
            legacy: false,
        };
    }

    if (!legacyTokensEnabled()) {
        throw tokenError('LEGACY_TOKEN_REJECTED', 'Token legado fora da janela de migração');
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded?._id) throw tokenError('TOKEN_SUBJECT_MISMATCH');
    recordLegacyAcceptance('access', expectedActors);
    return {
        ...decoded,
        subjectId: String(decoded._id),
        actorType: null,
        tokenType: 'access',
        legacy: true,
    };
};

module.exports.signShareToken = ({ rideId, userId, expiresIn = '6h' }) => {
    const subjectId = String(rideId);
    return jwt.sign(
        {
            rideId: subjectId,
            userId: String(userId),
            scope: 'ride_share',
            tokenType: 'share',
            ver: TOKEN_VERSION,
        },
        secretFor(null, 'share'),
        {
            algorithm: 'HS256',
            expiresIn,
            subject: subjectId,
            issuer: TOKEN_ISSUER,
            audience: SHARE_AUDIENCE,
            jwtid: crypto.randomUUID(),
        }
    );
};

module.exports.verifyShareToken = (token) => {
    const untrusted = jwt.decode(token);
    if (untrusted?.ver === TOKEN_VERSION || untrusted?.tokenType) {
        const decoded = jwt.verify(token, secretFor(null, 'share'), {
            algorithms: ['HS256'],
            issuer: TOKEN_ISSUER,
            audience: SHARE_AUDIENCE,
        });
        if (decoded.ver !== TOKEN_VERSION || decoded.tokenType !== 'share' || decoded.scope !== 'ride_share') {
            throw tokenError('TOKEN_PURPOSE_MISMATCH', 'Compartilhamento inválido');
        }
        if (!decoded.sub || String(decoded.sub) !== String(decoded.rideId)) {
            throw tokenError('TOKEN_SUBJECT_MISMATCH', 'Subject do compartilhamento inválido');
        }
        return decoded;
    }
    if (!legacyTokensEnabled()) throw tokenError('LEGACY_TOKEN_REJECTED');
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded?.scope !== 'ride_share' || !decoded?.rideId || !decoded?.userId) {
        throw tokenError('TOKEN_PURPOSE_MISMATCH');
    }
    recordLegacyAcceptance('share');
    return { ...decoded, legacy: true };
};

// Emite um par novo (login). O refresh token cru é devolvido pro chamador entregar ao
// cliente; no banco fica só o hash.
module.exports.issueTokenPair = async ({ userId, userType, extraClaims = {}, ip }) => {
    assertActorType(userType);
    const accessToken = module.exports.generateAccessToken(userId, userType, extraClaims);

    const refreshToken = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await refreshTokenModel.create({
        tokenHash: hashToken(refreshToken),
        userId,
        userType,
        familyId: crypto.randomUUID(),
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
// janela depois de já ter sido rotacionado deixa de derrubar a sessão inteira, mas NÃO
// cria outro refresh. A requisição concorrente recebe somente um access token curto; o
// cookie/localStorage compartilhado já recebe o único sucessor criado pela vencedora.
// Fora da janela, o comportamento continua sendo tratar o reuso como roubo e revogar a
// família comprometida.
const REUSE_GRACE_MS = 30 * 1000;
const ROTATION_TRANSACTION_OPTIONS = Object.freeze({
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
    readPreference: 'primary',
});
module.exports.REUSE_GRACE_MS = REUSE_GRACE_MS;

// Segue a cadeia de rotação a partir de um token já substituído até achar o elo
// atualmente válido. Devolve `null` se a cadeia estiver cortada (um elo intermediário
// foi revogado por outro motivo, ex: logout explícito no meio da janela) — nesse caso
// não há elo seguro pra continuar, e quem chamou deve tratar como reuso de verdade.
async function walkToCurrent(stored, session) {
    let current = stored;
    const seen = new Set([current.tokenHash]);
    while (current.replacedBy) {
        if (seen.has(current.replacedBy)) return null; // ciclo — nunca deveria existir
        seen.add(current.replacedBy);
        const next = await refreshTokenModel.findOne(
            { tokenHash: current.replacedBy },
            null,
            { session }
        );
        if (!next) return null;
        if (next.revokedAt && !next.replacedBy) return null; // revogado sem suceder ninguém (ex: logout)
        if (String(next.userId) !== String(stored.userId) || next.userType !== stored.userType) return null;
        current = next;
    }
    return current;
}

function rotationError(code, message) {
    return { kind: 'error', code, message };
}

// Troca um refresh token por outro com claim CAS e criação do sucessor na mesma
// transação. Assim, duas instâncias não conseguem confirmar dois sucessores e uma falha
// depois do claim não deixa a sessão permanentemente quebrada.
module.exports.rotateRefreshToken = async ({ refreshToken, expectedUserType, ip }) => {
    if (!refreshToken) {
        throw tokenError('MISSING_REFRESH_TOKEN', 'Refresh token ausente');
    }

    const tokenHash = hashToken(refreshToken);
    const preflight = await refreshTokenModel.findOne({ tokenHash });

    if (!preflight) {
        throw tokenError('INVALID_REFRESH_TOKEN', 'Sessão inválida');
    }

    if (expectedUserType && preflight.userType !== expectedUserType) {
        throw tokenError('REFRESH_ACTOR_MISMATCH', 'Refresh token emitido para outro ator');
    }

    const newRefreshToken = crypto.randomBytes(48).toString('hex');
    const newHash = hashToken(newRefreshToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const familyId = preflight.familyId || crypto.randomUUID();
    const session = await mongoose.startSession();

    try {
        // O retry externo cobre um CAS perdido sem erro transitório (útil também em
        // doubles de teste). WriteConflict real é repetido pelo próprio withTransaction.
        for (let attempt = 0; attempt < 3; attempt += 1) {
            let outcome;

            await session.withTransaction(async () => {
                const stored = await refreshTokenModel.findOne({ tokenHash }, null, { session });

                if (!stored) {
                    outcome = rotationError('INVALID_REFRESH_TOKEN', 'Sessão inválida');
                    return;
                }
                if (expectedUserType && stored.userType !== expectedUserType) {
                    outcome = rotationError('REFRESH_ACTOR_MISMATCH', 'Refresh token emitido para outro ator');
                    return;
                }

                if (stored.revokedAt || stored.replacedBy) {
                    const withinGrace = Boolean(
                        stored.replacedBy
                        && stored.revokedAt
                        && (now.getTime() - stored.revokedAt.getTime()) < REUSE_GRACE_MS
                    );
                    const current = withinGrace ? await walkToCurrent(stored, session) : null;

                    if (current && current.expiresAt > now) {
                        outcome = {
                            kind: 'grace',
                            userId: stored.userId,
                            userType: stored.userType,
                            refreshTokenExpiresAt: current.expiresAt,
                        };
                        return;
                    }

                    const familyFilter = stored.familyId
                        ? { familyId: stored.familyId, revokedAt: null }
                        : { userId: stored.userId, userType: stored.userType, revokedAt: null };
                    await refreshTokenModel.updateMany(
                        familyFilter,
                        { $set: { revokedAt: now, revokedReason: 'reuse_detected' } },
                        { session }
                    );
                    outcome = rotationError(
                        'REFRESH_TOKEN_REUSE',
                        'Sessão inválida — por segurança, a família comprometida foi encerrada'
                    );
                    return;
                }

                if (stored.expiresAt <= now) {
                    outcome = rotationError('EXPIRED_REFRESH_TOKEN', 'Sessão expirada');
                    return;
                }

                const claimed = await refreshTokenModel.findOneAndUpdate(
                    {
                        _id: stored._id,
                        tokenHash,
                        userType: stored.userType,
                        revokedAt: null,
                        replacedBy: null,
                        expiresAt: { $gt: now },
                    },
                    {
                        $set: {
                            familyId,
                            replacedBy: newHash,
                            revokedAt: now,
                            revokedReason: 'rotated',
                        },
                    },
                    { new: true, session }
                );

                if (!claimed) {
                    outcome = { kind: 'retry' };
                    return;
                }

                await refreshTokenModel.create([{
                    tokenHash: newHash,
                    userId: stored.userId,
                    userType: stored.userType,
                    familyId,
                    expiresAt,
                    createdByIp: ip,
                }], { session });

                outcome = {
                    kind: 'rotated',
                    userId: stored.userId,
                    userType: stored.userType,
                };
            }, ROTATION_TRANSACTION_OPTIONS);

            if (outcome?.kind === 'retry') continue;
            if (outcome?.kind === 'error') {
                if (outcome.code === 'REFRESH_TOKEN_REUSE') {
                    recordRefreshEvent('refreshReuseDetected', 'AUTH_REFRESH_TOKEN_REUSE', preflight.userType);
                }
                throw tokenError(outcome.code, outcome.message);
            }
            if (outcome?.kind === 'grace') {
                recordRefreshEvent('refreshGraceAccessOnly', null, outcome.userType);
                return {
                    userId: outcome.userId,
                    userType: outcome.userType,
                    refreshToken: null,
                    refreshTokenExpiresAt: outcome.refreshTokenExpiresAt,
                    graceAccessOnly: true,
                };
            }
            if (outcome?.kind === 'rotated') {
                recordRefreshEvent('refreshRotated', null, outcome.userType);
                return {
                    userId: outcome.userId,
                    userType: outcome.userType,
                    refreshToken: newRefreshToken,
                    refreshTokenExpiresAt: expiresAt,
                    graceAccessOnly: false,
                };
            }
        }

        recordRefreshEvent('refreshConflicts', 'AUTH_REFRESH_ROTATION_CONFLICT', preflight.userType);
        throw tokenError('REFRESH_ROTATION_CONFLICT', 'Não foi possível confirmar a rotação da sessão');
    } finally {
        await session.endSession();
    }
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
