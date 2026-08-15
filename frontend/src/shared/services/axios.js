import axios from 'axios';
import { API_BASE_URL } from './apiBase';
import { getFriendlyErrorMessage } from './errorMessages';
import {
    getAccessToken,
    getLegacyRefreshToken,
    discardLegacyRefreshToken,
    saveSession,
    clearSession,
    clearAllSessions,
    sessionKindForUrl,
    LOGIN_ROUTE,
} from './session';
import { syncTokenWithSW } from './swCommunication';
import { getAppRole, isNativePlatform } from '@/shared/platform/platform';
import { getNativeCaptainRefreshToken } from '@/shared/platform/nativeSession.service';

const api = axios.create({
    baseURL: API_BASE_URL || undefined,
    timeout: 10000, // 10s timeout
    // Auditoria de sessão (2026-08-02): sem isto o cookie httpOnly com o refresh token
    // nunca era enviado — os cookies que o backend já setava não serviam pra nada.
    withCredentials: true,
});

// Interceptor de Requisição: Injeta o token se existir
api.interceptors.request.use((config) => {
    if (isNativePlatform() && getAppRole() === 'driver') {
        config.headers['X-MoveCity-Client'] = 'android-driver';
    }
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
// Agora: um 401 dispara UMA renovação silenciosa por ator. Passageiro e motorista
// podem coexistir na mesma aba sem compartilhar fila ou receber o token um do outro.
const refreshPromises = { user: null, captain: null };

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

    const refreshKind = kind
        || (getAccessToken('captain') ? 'captain' : null)
        || (getAccessToken('user') ? 'user' : null)
        || (getAppRole() === 'driver' ? 'captain' : 'user');

    try {
        const newToken = await refreshAccessToken(refreshKind);
        config._retriedAfterRefresh = true;
        config.headers.Authorization = `Bearer ${newToken}`;
        return api(config);
    } catch (refreshError) {
        return Promise.reject(refreshError);
    }
});

// Auditoria de regressão de push (2026-08-03): extraído do interceptor acima pra ser
// reutilizável fora de uma resposta HTTP — especificamente pelo `join` do Socket.IO
// (frontend/src/services/socketAuth.js). O `join` passou a exigir token válido (C1/C2
// da auditoria PWA), mas nada nas telas de espera de corrida faz chamada REST
// periódica, então o token pode ficar vencido por tempo indefinido sem nenhum 401
// pra disparar a renovação de dentro do interceptor — o motorista caía fora do
// despacho silenciosamente numa reconexão de socket com token vencido. A Promise por
// ator também é reutilizada pelo interceptor, sem misturar passageiro e motorista.
export async function refreshAccessToken(kind) {
    if (!refreshPromises[kind]) {
        refreshPromises[kind] = (async () => {
            const nativeDriver = kind === 'captain' && isNativePlatform() && getAppRole() === 'driver';
            const refreshToken = nativeDriver
                ? await getNativeCaptainRefreshToken()
                : getLegacyRefreshToken(kind);
            const endpoint = kind === 'captain' ? '/captains/refresh' : '/users/refresh';
            const headers = refreshToken && !nativeDriver
                ? { 'X-MoveCity-Refresh-Migration': 'v1' }
                : {};
            try {
                const { data } = await api.post(endpoint, refreshToken ? { refreshToken } : {}, { headers });

                if (refreshToken && !nativeDriver) discardLegacyRefreshToken(kind);
                saveSession(kind, { token: data.token, refreshToken: data.refreshToken });
                // O Service Worker só consegue aceitar corrida em segundo plano se tiver
                // um access token curto e atual no IndexedDB.
                syncTokenWithSW(data.token);
                return data.token;
            } catch (refreshError) {
                const status = refreshError.response?.status;
                if (status === 401 || status === 403) {
                    if (refreshToken && !nativeDriver) discardLegacyRefreshToken(kind);
                    forceLogout(kind);
                }
                throw refreshError;
            }
        })().finally(() => {
            refreshPromises[kind] = null;
        });
    }

    return refreshPromises[kind];
}

export default api;
