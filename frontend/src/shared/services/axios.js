import axios from 'axios';
import { API_BASE_URL } from './apiBase';
import { getFriendlyErrorMessage } from './errorMessages';
import {
    getAccessToken,
    getRefreshToken,
    saveSession,
    clearSession,
    clearAllSessions,
    sessionKindForUrl,
    LOGIN_ROUTE,
} from './session';
import { syncTokenWithSW } from './swCommunication';

const api = axios.create({
    baseURL: API_BASE_URL || undefined,
    timeout: 10000, // 10s timeout
    // Auditoria de sessão (2026-08-02): sem isto o cookie httpOnly com o refresh token
    // nunca era enviado — os cookies que o backend já setava não serviam pra nada.
    withCredentials: true,
});

// Interceptor de Requisição: Injeta o token se existir
api.interceptors.request.use((config) => {
    // Fase 1 da auditoria de production readiness (C1, 2026-08-05): as chamadas
    // migradas do axios cru podem trazer Authorization explícito — em rotas que
    // sessionKindForUrl não classifica (ex: /captains/wallet vem com o prefixo
    // /captains, mas /notifications/token e /chat/* não), sobrescrever o header
    // explícito trocaria o token certo pelo fallback (user > captain) e quebraria a
    // sessão dupla. Header explícito do chamador sempre vence.
    const explicitAuth = typeof config.headers?.get === 'function'
        ? config.headers.get('Authorization')
        : config.headers?.Authorization;
    if (explicitAuth) return config;

    // Escolhe o token com base na rota para evitar conflitos em testes na mesma máquina
    const kind = sessionKindForUrl(config.url || '');
    const token = kind
        ? getAccessToken(kind)
        : (getAccessToken('user') || getAccessToken('captain'));

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

// Auditoria de autenticação e sessão persistente (2026-08-02).
//
// Antes: QUALQUER 401 apagava o token e fazia window.location.href pro login — sem
// nunca tentar renovar, e com reload duro (perdia a rota atual e todo o estado em
// memória). Como o access token durava 24h e não existia renovação nenhuma, todo
// usuário era deslogado pelo menos uma vez por dia.
//
// Agora: um 401 dispara UMA tentativa de renovação silenciosa; só desloga se a
// renovação também falhar (sessão comprovadamente inválida). isRefreshing + a fila
// garantem que N requisições falhando juntas disparem um único refresh.
let isRefreshing = false;
let refreshQueue = [];

const flushQueue = (error, token = null) => {
    refreshQueue.forEach(({ resolve, reject }) => {
        if (error) reject(error);
        else resolve(token);
    });
    refreshQueue = [];
};

const forceLogout = (kind) => {
    if (kind) {
        clearSession(kind);
        window.location.href = LOGIN_ROUTE[kind];
    } else {
        clearAllSessions();
        window.location.href = LOGIN_ROUTE.user;
    }
};

api.interceptors.response.use((response) => response, async (error) => {
    const config = error.config;
    const status = error.response?.status;

    // Sem resposta = rede caiu, timeout, backend hibernando. NUNCA desloga por isso —
    // era exatamente o que acontecia antes e derrubava a sessão de quem só passou por
    // uma instabilidade momentânea de conexão.
    if (!error.response) {
        error.friendlyMessage = getFriendlyErrorMessage(error);
        return Promise.reject(error);
    }

    const kind = sessionKindForUrl(config?.url || '');

    // 403 de conta bloqueada é decisão deliberada do backend, não expiração — desloga
    // direto, sem tentar renovar (renovar não resolveria: o backend recusaria de novo).
    if (status === 403 && /bloquead/i.test(error.response?.data?.message || '')) {
        forceLogout(kind);
        error.friendlyMessage = error.response?.data?.message;
        return Promise.reject(error);
    }

    if (status !== 401) {
        error.friendlyMessage = getFriendlyErrorMessage(error);
        return Promise.reject(error);
    }

    const isRefreshCall = (config?.url || '').includes('/refresh');
    const isAuthCall = /\/(login|register|google-login)/.test(config?.url || '');

    // 401 no próprio refresh = a sessão realmente acabou.
    if (isRefreshCall) {
        forceLogout(kind);
        return Promise.reject(error);
    }
    // 401 no login = credenciais erradas; não tem relação com sessão expirada.
    if (isAuthCall) {
        error.friendlyMessage = getFriendlyErrorMessage(error);
        return Promise.reject(error);
    }

    if (config._retriedAfterRefresh) {
        forceLogout(kind);
        return Promise.reject(error);
    }

    const refreshKind = kind || (getRefreshToken('user') ? 'user' : 'captain');

    try {
        const newToken = await refreshAccessToken(refreshKind);
        config._retriedAfterRefresh = true;
        config.headers.Authorization = `Bearer ${newToken}`;
        return api(config);
    } catch (refreshError) {
        return Promise.reject(error);
    }
});

// Auditoria de regressão de push (2026-08-03): extraído do interceptor acima pra ser
// reutilizável fora de uma resposta HTTP — especificamente pelo `join` do Socket.IO
// (frontend/src/services/socketAuth.js). O `join` passou a exigir token válido (C1/C2
// da auditoria PWA), mas nada nas telas de espera de corrida faz chamada REST
// periódica, então o token pode ficar vencido por tempo indefinido sem nenhum 401
// pra disparar a renovação de dentro do interceptor — o motorista caía fora do
// despacho silenciosamente numa reconexão de socket com token vencido. Mantém a MESMA
// fila (`isRefreshing`/`refreshQueue`) do interceptor, então uma renovação disparada
// pelo socket e uma disparada por uma chamada REST concorrente nunca duplicam a
// chamada ao backend.
export async function refreshAccessToken(kind) {
    if (isRefreshing) {
        return new Promise((resolve, reject) => {
            refreshQueue.push({ resolve, reject });
        });
    }

    isRefreshing = true;
    try {
        const refreshToken = getRefreshToken(kind);
        const endpoint = kind === 'captain' ? '/captains/refresh' : '/users/refresh';
        // Sem refresh token no localStorage ainda vale tentar: ele pode estar no cookie
        // httpOnly, que o JS não enxerga mas o navegador envia (withCredentials).
        const { data } = await api.post(endpoint, refreshToken ? { refreshToken } : {});

        saveSession(kind, { token: data.token, refreshToken: data.refreshToken });
        // C1 da auditoria de push (2026-08-02): o Service Worker do motorista só consegue
        // aceitar corrida em segundo plano se tiver um access token válido no IndexedDB —
        // sem sincronizar aqui, ele ficaria com o token antigo até a próxima abertura do app.
        syncTokenWithSW(data.token);
        isRefreshing = false;
        flushQueue(null, data.token);
        return data.token;
    } catch (refreshError) {
        isRefreshing = false;
        flushQueue(refreshError);
        forceLogout(kind);
        throw refreshError;
    }
}

export default api;
