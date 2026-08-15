const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    csrfProtection,
} = require('../../middlewares/csrfProtection.middleware');
const {
    getBearerToken,
    resolveAccessToken,
} = require('../../utils/authToken');

function runMiddleware({
    method = 'POST',
    cookies = {},
    headers = {},
} = {}) {
    const normalizedHeaders = Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
    );
    const req = {
        method,
        cookies,
        get(name) {
            return normalizedHeaders[name.toLowerCase()];
        },
    };
    const response = { statusCode: 200, body: undefined };
    const res = {
        status(statusCode) {
            response.statusCode = statusCode;
            return this;
        },
        json(body) {
            response.body = body;
            return this;
        },
    };
    let nextCalled = false;

    csrfProtection(req, res, () => {
        nextCalled = true;
    });

    return { nextCalled, ...response };
}

test('requisições seguras continuam permitidas mesmo quando autenticadas por cookie', () => {
    const result = runMiddleware({ method: 'GET', cookies: { token: 'cookie-jwt' } });

    assert.equal(result.nextCalled, true);
});

test('POST público sem credencial ambiente não exige origem', () => {
    const result = runMiddleware();

    assert.equal(result.nextCalled, true);
});

test('cliente nativo com Bearer não depende de Origin, mesmo se houver cookie antigo', () => {
    const result = runMiddleware({
        cookies: { token: 'cookie-antigo' },
        headers: { authorization: 'Bearer jwt-nativo' },
    });

    assert.equal(result.nextCalled, true);
});

test('POST autenticado por cookie aceita uma Origin autorizada', () => {
    const result = runMiddleware({
        cookies: { token: 'cookie-jwt' },
        headers: { origin: 'https://moovecity.com.br' },
    });

    assert.equal(result.nextCalled, true);
});

test('origens dos aplicativos Android e WebView continuam autorizadas', () => {
    for (const origin of [
        'https://localhost',
        'http://localhost',
        'capacitor://localhost',
        'ionic://localhost',
    ]) {
        const result = runMiddleware({
            cookies: { token: 'cookie-jwt' },
            headers: { origin },
        });

        assert.equal(result.nextCalled, true, `origem deveria ser aceita: ${origin}`);
    }
});

test('POST autenticado por cookie aceita Referer autorizado quando Origin não existe', () => {
    const result = runMiddleware({
        cookies: { refreshToken: 'cookie-refresh' },
        headers: { referer: 'https://www.moovecity.com.br/conta/sessoes' },
    });

    assert.equal(result.nextCalled, true);
});

test('POST autenticado por cookie rejeita origem maliciosa', () => {
    const result = runMiddleware({
        cookies: { token: 'cookie-jwt' },
        headers: { origin: 'https://evil.example' },
    });

    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 403);
    assert.equal(result.body.code, 'CSRF_ORIGIN_REJECTED');
});

test('POST autenticado por cookie rejeita ausência de Origin e Referer', () => {
    const result = runMiddleware({ cookies: { adminToken: 'admin-cookie' } });

    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 403);
    assert.equal(result.body.code, 'CSRF_ORIGIN_REQUIRED');
});

test('Bearer válido é extraído estritamente e tem prioridade sobre cookie', () => {
    const bearerRequest = {
        cookies: { token: 'cookie-antigo' },
        get: (name) => name.toLowerCase() === 'authorization' ? 'Bearer jwt-atual' : undefined,
    };
    const malformedRequest = {
        cookies: { token: 'cookie-valido' },
        get: () => 'Basic credencial',
    };

    assert.equal(getBearerToken(bearerRequest), 'jwt-atual');
    assert.deepEqual(resolveAccessToken(bearerRequest, 'token'), {
        token: 'jwt-atual',
        source: 'bearer',
    });
    assert.equal(getBearerToken(malformedRequest), null);
    assert.deepEqual(resolveAccessToken(malformedRequest, 'token'), {
        token: 'cookie-valido',
        source: 'cookie',
    });
});

test('contrato de logout usa POST e nunca transporta refresh token na URL', () => {
    const backendRoot = path.resolve(__dirname, '../..');
    const repositoryRoot = path.resolve(backendRoot, '..');
    const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

    const userRoutes = read('Backend/routes/user.routes.js');
    const captainRoutes = read('Backend/routes/captain.routes.js');
    const userController = read('Backend/controllers/user.controller.js');
    const captainController = read('Backend/controllers/captain.controller.js');
    const userLogout = read('frontend/src/passenger/pages/UserLogout.jsx');
    const captainLogout = read('frontend/src/driver/pages/CaptainLogout.jsx');

    assert.match(userRoutes, /router\.post\(['"]\/logout['"]/);
    assert.match(captainRoutes, /router\.post\(['"]\/logout['"]/);
    assert.doesNotMatch(userRoutes, /router\.get\(['"]\/logout['"]/);
    assert.doesNotMatch(captainRoutes, /router\.get\(['"]\/logout['"]/);
    assert.doesNotMatch(userController, /req\.query\??\.refreshToken/);
    assert.doesNotMatch(captainController, /req\.query\??\.refreshToken/);
    assert.match(userLogout, /axios\.post\(/);
    assert.match(captainLogout, /api\.post\(['"]\/captains\/logout['"]/);
    assert.doesNotMatch(userLogout, /params\s*:\s*refreshToken/);
    assert.doesNotMatch(captainLogout, /params\s*:\s*refreshToken/);
});
