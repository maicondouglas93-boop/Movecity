const { isOriginAllowed } = require('../config/corsOrigins');
const { getBearerToken } = require('../utils/authToken');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTH_COOKIE_NAMES = [
    'userAccessToken', 'captainAccessToken', 'adminAccessToken',
    'userRefreshToken', 'captainRefreshToken', 'adminRefreshToken',
    // Compatibilidade temporária com sessões anteriores ao COR-2003.
    'token', 'adminToken', 'refreshToken',
];

function hasAuthenticationCookie(req) {
    return AUTH_COOKIE_NAMES.some((name) => Boolean(req.cookies?.[name]));
}

function getRequestOrigin(req) {
    const origin = req.get('origin');
    if (origin) return origin;

    const referer = req.get('referer');
    if (!referer) return null;

    try {
        return new URL(referer).origin;
    } catch {
        return null;
    }
}

function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method.toUpperCase())) return next();

    // Bearer não é credencial ambiente: uma página atacante não consegue adicionar
    // esse header sem disparar preflight CORS. Isso mantém apps nativos e WebViews
    // compatíveis, inclusive quando carregam um cookie antigo no armazenamento.
    if (getBearerToken(req)) return next();

    // Login, cadastro e webhooks sem cookie não estão sujeitos a CSRF porque não há
    // credencial que o navegador possa anexar silenciosamente.
    if (!hasAuthenticationCookie(req)) return next();

    const requestOrigin = getRequestOrigin(req);
    if (!requestOrigin) {
        return res.status(403).json({
            code: 'CSRF_ORIGIN_REQUIRED',
            message: 'Origem da requisição é obrigatória para autenticação por cookie.',
        });
    }

    if (!isOriginAllowed(requestOrigin)) {
        return res.status(403).json({
            code: 'CSRF_ORIGIN_REJECTED',
            message: 'Origem da requisição não autorizada.',
        });
    }

    return next();
}

module.exports = {
    csrfProtection,
    getRequestOrigin,
    hasAuthenticationCookie,
};
