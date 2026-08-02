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

export function saveSession(kind, { token, refreshToken }) {
    const keys = KEYS[kind];
    if (!keys) throw new Error(`Tipo de sessão desconhecido: ${kind}`);
    if (token) localStorage.setItem(keys.access, token);
    // O refresh token pode não vir no corpo se o backend decidir entregar só via
    // cookie httpOnly — nesse caso não sobrescreve o que já existe com undefined.
    if (refreshToken) localStorage.setItem(keys.refresh, refreshToken);
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
}

export function clearAllSessions() {
    Object.values(KEYS).forEach(({ access, refresh }) => {
        localStorage.removeItem(access);
        localStorage.removeItem(refresh);
    });
}

// Qual sessão uma requisição usa é decidido pela rota — o mesmo navegador pode ter
// login de passageiro e de motorista ao mesmo tempo (comum em testes na mesma máquina).
export function sessionKindForUrl(url = '') {
    if (url.includes('/captains')) return 'captain';
    if (url.includes('/users')) return 'user';
    return null;
}

export const LOGIN_ROUTE = { user: '/login', captain: '/captain-login' };
