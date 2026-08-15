const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(backendRoot, '..');
const readBackend = (file) => fs.readFileSync(path.join(backendRoot, file), 'utf8');
const readRepo = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const authService = require('../../services/auth.service');

function withAuthEnv(values, callback) {
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    Object.entries(values).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
    try {
        return callback();
    } finally {
        Object.entries(previous).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    }
}

test('cookies de access e refresh têm nomes separados por ator', () => {
    const auth = readBackend('services/auth.service.js');
    const commonMiddleware = readBackend('middlewares/auth.middleware.js');
    const adminMiddleware = readBackend('middlewares/adminAuth.middleware.js');

    for (const name of [
        'userAccessToken', 'captainAccessToken', 'adminAccessToken',
        'userRefreshToken', 'captainRefreshToken', 'adminRefreshToken',
    ]) {
        assert.match(auth + commonMiddleware + adminMiddleware, new RegExp(name));
    }
});

test('refresh em corpo é restrito ao Android seguro ou à janela explícita de migração', () => {
    const auth = readBackend('services/auth.service.js');
    const env = readBackend('.env.example');

    assert.match(auth, /resolveRefreshToken/);
    assert.match(auth, /android-driver/);
    assert.match(auth, /REFRESH_BODY_MIGRATION_UNTIL/);
    assert.match(env, /^REFRESH_BODY_MIGRATION_UNTIL=/m);
    assert.match(auth, /shouldExposeRefreshToken/);
});

test('CSRF reconhece todos os cookies de autenticação por ator', () => {
    const csrf = readBackend('middlewares/csrfProtection.middleware.js');

    for (const name of [
        'userAccessToken', 'captainAccessToken', 'adminAccessToken',
        'userRefreshToken', 'captainRefreshToken', 'adminRefreshToken',
    ]) {
        assert.match(csrf, new RegExp(name));
    }
});

test('frontend web não persiste access ou refresh token no localStorage', () => {
    const session = readRepo('frontend/src/shared/services/session.js');
    const axiosClient = readRepo('frontend/src/shared/services/axios.js');
    const adminApi = readRepo('admin-frontend/src/services/api.js');
    const adminAuth = readRepo('admin-frontend/src/contexts/AuthContext.jsx');

    assert.doesNotMatch(session, /localStorage\.setItem\([^\n]*(?:token|refresh)/i);
    assert.doesNotMatch(axiosClient, /localStorage\.setItem\([^\n]*(?:token|refresh)/i);
    assert.doesNotMatch(adminApi, /localStorage\.(?:setItem|getItem)\(['"]admin(?:Refresh)?Token/);
    assert.doesNotMatch(adminAuth, /localStorage\.(?:setItem|getItem)\(['"]admin(?:Refresh)?Token/);
});

test('APK motorista lê refresh do store criptografado e identifica o transporte nativo', () => {
    const nativeStore = readRepo('frontend/android/app/src/main/java/br/com/movecity/driver/NativeSessionStore.java');
    const nativePlugin = readRepo('frontend/android/app/src/main/java/br/com/movecity/driver/NativeSessionPlugin.java');
    const nativeRefresh = readRepo('frontend/android/app/src/main/java/br/com/movecity/driver/RideOfferAcceptHelper.java');
    const jsBridge = readRepo('frontend/src/shared/platform/nativeSession.service.js');

    assert.match(nativeStore, /EncryptedSharedPreferences/);
    assert.doesNotMatch(nativeStore, /fallback MODE_PRIVATE/);
    assert.match(nativeStore, /Secure session storage unavailable/);
    assert.match(nativePlugin, /void get\(PluginCall call\)/);
    assert.match(jsBridge, /getNativeCaptainRefreshToken/);
    assert.match(nativeRefresh, /X-MoveCity-Client/);
    assert.match(nativeRefresh, /android-driver/);
});

test('wrappers protegidos confirmam a sessão no servidor sem depender de segredo legível por JS', () => {
    const userWrapper = readRepo('frontend/src/passenger/pages/UserProtectWrapper.jsx');
    const captainWrapper = readRepo('frontend/src/driver/pages/CaptainProtectWrapper.jsx');

    assert.doesNotMatch(userWrapper, /getRefreshToken/);
    assert.doesNotMatch(captainWrapper, /getRefreshToken/);
    assert.match(userWrapper, /refreshAccessToken/);
    assert.match(captainWrapper, /refreshAccessToken/);
});

test('resolver rejeita refresh web no corpo fora da janela e prioriza cookie do ator', () => {
    withAuthEnv({ NODE_ENV: 'production', REFRESH_BODY_MIGRATION_UNTIL: undefined }, () => {
        assert.equal(authService.resolveRefreshToken({ body: { refreshToken: 'body' } }, 'user'), null);
        assert.equal(authService.resolveRefreshToken({
            body: { refreshToken: 'body' },
            cookies: { userRefreshToken: 'cookie-user' },
        }, 'user'), 'cookie-user');
        assert.equal(authService.resolveRefreshToken({
            body: { refreshToken: 'body' },
            headers: { 'x-movecity-client': 'android-driver' },
        }, 'user'), null);
    });

    withAuthEnv({
        NODE_ENV: 'production',
        REFRESH_BODY_MIGRATION_UNTIL: new Date(Date.now() + 60_000).toISOString(),
    }, () => {
        assert.equal(authService.resolveRefreshToken({
            body: { refreshToken: 'legacy-body' },
            headers: { 'x-movecity-refresh-migration': 'v1' },
        }, 'user'), 'legacy-body');
    });
});

test('Android só recebe refresh quando apresenta o segredo seguro ou inicia sessão', () => {
    withAuthEnv({ NODE_ENV: 'production' }, () => {
        const nativeRefresh = {
            body: { refreshToken: 'native-secret' },
            headers: { 'x-movecity-client': 'android-driver' },
        };
        const headerOnly = {
            body: {},
            cookies: { captainRefreshToken: 'cookie-secret' },
            headers: { 'x-movecity-client': 'android-driver' },
        };

        assert.equal(authService.resolveRefreshToken(nativeRefresh, 'captain'), 'native-secret');
        assert.equal(authService.shouldExposeRefreshToken(nativeRefresh, 'captain'), true);
        assert.equal(authService.shouldExposeRefreshToken(headerOnly, 'captain'), false);
        assert.equal(authService.shouldExposeRefreshToken(headerOnly, 'captain', { newSession: true }), true);
    });
});
