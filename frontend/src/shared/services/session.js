// Auditoria de autenticação e sessão persistente (2026-08-02).
//
// Antes, cada tela de login/cadastro escrevia direto no localStorage
// (`localStorage.setItem('token', ...)`) em 6 lugares diferentes, e o refresh token
// nem existia. Centralizar aqui é o que torna possível guardar o par de tokens de
// forma consistente e, principalmente, ter UM lugar que decide o que significa
// "encerrar a sessão".
//
// Sobre segurança do armazenamento: o refresh token também vem num cookie httpOnly
// (inacessível ao JS). O que fica aqui é um fallback para navegadores que bloqueiam
// cookie de terceiros (Safari/ITP) — sem ele, esses usuários não conseguiriam manter
// a sessão. O backend aceita o refresh token do cookie ou do corpo da requisição.

const KEYS = {
    user: { access: 'token', refresh: 'refreshToken' },
    captain: { access: 'captain-token', refresh: 'captain-refreshToken' },
};

// Auditoria PWA (2026-08-03, A2): único jeito síncrono e confiável de saber "existe
// sessão ativa agora", sem depender de UserDataContext/CaptainDataContext — o primeiro
// começa como um objeto vazio (não null) mesmo deslogado, e nenhum dos dois é
// preenchido de forma consistente antes do login. Usado por LocationContext pra não
// ligar o GPS de alta precisão antes de existir alguém logado.
const SESSION_CHANGED_EVENT = 'movecity:session-changed';

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

export function saveSession(kind, { token, refreshToken }) {
    const keys = KEYS[kind];
    if (!keys) throw new Error(`Tipo de sessão desconhecido: ${kind}`);
    if (token) localStorage.setItem(keys.access, token);
    // O refresh token pode não vir no corpo se o backend decidir entregar só via
    // cookie httpOnly — nesse caso não sobrescreve o que já existe com undefined.
    if (refreshToken) localStorage.setItem(keys.refresh, refreshToken);
    notifySessionChanged();
    // Espelha no nativo (APK) para Aceitar corrida com app morto / lock screen.
    if (kind === 'captain') {
        import('@/shared/platform/nativeSession.service')
            .then(({ syncNativeCaptainSession }) => syncNativeCaptainSession({
                token: token || getAccessToken('captain'),
                refreshToken: refreshToken || getRefreshToken('captain'),
            }))
            .catch(() => {});
    }
}

export function getAccessToken(kind) {
    return localStorage.getItem(KEYS[kind].access);
}

export function getRefreshToken(kind) {
    return localStorage.getItem(KEYS[kind].refresh);
}

export function clearSession(kind) {
    const keys = KEYS[kind];
    localStorage.removeItem(keys.access);
    localStorage.removeItem(keys.refresh);
    notifySessionChanged();
    if (kind === 'captain') {
        import('@/shared/platform/nativeSession.service')
            .then(({ clearNativeCaptainSession }) => clearNativeCaptainSession())
            .catch(() => {});
    }
}

export function clearAllSessions() {
    Object.values(KEYS).forEach(({ access, refresh }) => {
        localStorage.removeItem(access);
        localStorage.removeItem(refresh);
    });
    notifySessionChanged();
    import('@/shared/platform/nativeSession.service')
        .then(({ clearNativeCaptainSession }) => clearNativeCaptainSession())
        .catch(() => {});
}

// Qual sessão uma requisição usa é decidido pela rota — o mesmo navegador pode ter
// login de passageiro e de motorista ao mesmo tempo (comum em testes na mesma máquina).
//
// Correção 401 do motorista (2026-08-03): access token dura 15 min. Rotas de corrida
// do motorista (/rides/update-status, /accept, …) antes caíam no fallback genérico
// `user || captain` — com sessão dupla usava o token do PASSAGEIRO (authCaptain → 401)
// e, nos fluxos com axios/fetch cru, nem disparava o refresh. Classificar aqui é o
// que permite o interceptor renovar o token certo.
export function sessionKindForUrl(url = '') {
    const path = String(url).split('?')[0];

    if (path.includes('/captains')) return 'captain';
    if (path.includes('/users')) return 'user';
    if (path.includes('/uploads/captain-profile')) return 'captain';
    if (path.includes('/uploads/vehicle') || path.includes('/uploads/document')) return 'captain';
    if (path.includes('/uploads/profile')) return 'user';

    // Motorista — ordem importa: captain-cancel contém "cancel".
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

    // Encomendas — motorista
    if (path.includes('/parcels/pending')) return 'captain';
    if (path.includes('/parcels/captain-current')) return 'captain';
    if (path.includes('/parcels/captain-history')) return 'captain';
    if (path.includes('/parcels/captain-review')) return 'captain';
    if (/\/parcels\/[^/]+\/(accept|decline|confirm-delivery)(?:\/|$)/.test(path)) return 'captain';
    if (/\/parcels\/[^/]+\/status(?:\/|$)/.test(path)) return 'captain';

    // Passageiro
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
