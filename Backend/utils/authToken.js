function getHeader(req, name) {
    if (typeof req.get === 'function') {
        return req.get(name);
    }

    return req.headers?.[name.toLowerCase()];
}

function getBearerToken(req) {
    const authorization = getHeader(req, 'authorization');
    if (typeof authorization !== 'string') return null;

    const match = authorization.match(/^Bearer\s+(\S+)$/i);
    return match ? match[1] : null;
}

function resolveAccessToken(req, cookieName) {
    const bearerToken = getBearerToken(req);
    if (bearerToken) {
        return { token: bearerToken, source: 'bearer' };
    }

    const cookieToken = req.cookies?.[cookieName];
    if (cookieToken) {
        return { token: cookieToken, source: 'cookie' };
    }

    return { token: null, source: null };
}

module.exports = {
    getBearerToken,
    resolveAccessToken,
};
