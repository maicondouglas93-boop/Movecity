// Tokens de acesso vivem apenas na memória desta aba. O refresh web fica somente no
// cookie HttpOnly; no APK do motorista ele fica no armazenamento nativo criptografado.
// As chaves antigas são lidas uma única vez para migração e apagadas imediatamente.
const LEGACY_KEYS = {
    user: { access: 'token', refresh: 'refreshToken' },
    captain: { access: 'captain-token', refresh: 'captain-refreshToken' },
};

const accessTokens = { user: null, captain: null };
const legacyRefreshTokens = { user: null, captain: null };
const SESSION_CHANGED_EVENT = 'movecity:session-changed';

function assertKind(kind) {
    if (!LEGACY_KEYS[kind]) throw new Error(`Tipo de sessão desconhecido: ${kind}`);
}

function migrateLegacyWebStorage() {
    if (typeof localStorage === 'undefined') return;
    Object.entries(LEGACY_KEYS).forEach(([kind, keys]) => {
        accessTokens[kind] = localStorage.getItem(keys.access);
        legacyRefreshTokens[kind] = localStorage.getItem(keys.refresh);
        localStorage.removeItem(keys.access);
        localStorage.removeItem(keys.refresh);
    });
}

migrateLegacyWebStorage();

function notifySessionChanged() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
    }
}

export function onSessionChanged(callback) {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener(SESSION_CHANGED_EVENT, callback);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, callback);
}

export function hasActiveSession() {
    return !!(getAccessToken('user') || getAccessToken('captain'));
}

export function saveSession(kind, { token, refreshToken } = {}) {
    assertKind(kind);
    if (token) accessTokens[kind] = token;
    notifySessionChanged();

    if (kind === 'captain') {
        import('@/shared/platform/nativeSession.service')
            .then(({ syncNativeCaptainSession }) => syncNativeCaptainSession({
                token: token || accessTokens.captain,
                refreshToken,
            }))
            .catch(() => {});
    }
}

export function getAccessToken(kind) {
    assertKind(kind);
    return accessTokens[kind];
}

// Ponte one-shot: sessões web antigas podem girar o refresh armazenado para um cookie
// HttpOnly dentro da janela REFRESH_BODY_MIGRATION_UNTIL. Nunca grava um token novo.
export function getLegacyRefreshToken(kind) {
    assertKind(kind);
    return legacyRefreshTokens[kind];
}

export function discardLegacyRefreshToken(kind) {
    assertKind(kind);
    legacyRefreshTokens[kind] = null;
}

export function clearSession(kind) {
    assertKind(kind);
    accessTokens[kind] = null;
    legacyRefreshTokens[kind] = null;
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(LEGACY_KEYS[kind].access);
        localStorage.removeItem(LEGACY_KEYS[kind].refresh);
    }
    notifySessionChanged();
    if (kind === 'captain') {
        import('@/shared/platform/nativeSession.service')
            .then(({ clearNativeCaptainSession }) => clearNativeCaptainSession())
            .catch(() => {});
    }
}

export function clearAllSessions() {
    Object.keys(LEGACY_KEYS).forEach((kind) => {
        accessTokens[kind] = null;
        legacyRefreshTokens[kind] = null;
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(LEGACY_KEYS[kind].access);
            localStorage.removeItem(LEGACY_KEYS[kind].refresh);
        }
    });
    notifySessionChanged();
    import('@/shared/platform/nativeSession.service')
        .then(({ clearNativeCaptainSession }) => clearNativeCaptainSession())
        .catch(() => {});
}

// Qual sessão uma requisição usa é decidido pela rota — o mesmo navegador pode ter
// login de passageiro e de motorista ao mesmo tempo (comum em testes na mesma máquina).
export function sessionKindForUrl(url = '') {
    const path = String(url).split('?')[0];

    if (path.includes('/captains')) return 'captain';
    if (path.includes('/users')) return 'user';
    if (path.includes('/uploads/captain-profile')) return 'captain';
    if (path.includes('/uploads/vehicle') || path.includes('/uploads/document')) return 'captain';
    if (path.includes('/uploads/profile')) return 'user';

    if (path.includes('/rides/captain-cancel')) return 'captain';
    if (path.includes('/rides/captain-current')) return 'captain';
    if (path.includes('/rides/captain-history')) return 'captain';
    if (path.includes('/rides/update-status')) return 'captain';
    if (path.includes('/rides/start-ride')) return 'captain';
    if (path.includes('/rides/pending')) return 'captain';
    if (path.includes('/rides/end-ride')) return 'captain';
    if (path.includes('/rides/confirm-payment')) return 'captain';
    if (path.includes('/rides/captain-review')) return 'captain';
    if (/\/rides\/[^/]+\/(accept|decline)(?:\/|$)/.test(path)) return 'captain';

    if (path.includes('/parcels/pending')) return 'captain';
    if (path.includes('/parcels/captain-current')) return 'captain';
    if (path.includes('/parcels/captain-history')) return 'captain';
    if (path.includes('/parcels/captain-review')) return 'captain';
    if (/\/parcels\/[^/]+\/(accept|decline|confirm-delivery)(?:\/|$)/.test(path)) return 'captain';
    if (/\/parcels\/[^/]+\/status(?:\/|$)/.test(path)) return 'captain';

    if (path.includes('/rides/create')) return 'user';
    if (path.includes('/rides/current')) return 'user';
    if (path.includes('/rides/cancel')) return 'user';
    if (path.includes('/rides/get-fare') || path.includes('/rides/fare')) return 'user';
    if (path.includes('/parcels/create')) return 'user';
    if (path.includes('/parcels/current')) return 'user';
    if (path.includes('/parcels/fare')) return 'user';
    if (path.includes('/parcels/review')) return 'user';
    if (/\/parcels\/[^/]+\/cancel(?:\/|$)/.test(path)) return 'user';
    if (path.includes('/support')) return 'user';

    return null;
}

export const LOGIN_ROUTE = { user: '/login', captain: '/captain-login' };
