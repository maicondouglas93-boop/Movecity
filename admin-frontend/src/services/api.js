import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  withCredentials: true, // Importante para enviar cookies de refresh token (se aplicável)
});

// Interceptor para adicionar o token JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('adminToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

const forceLogout = () => {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminRefreshToken');
  localStorage.removeItem('adminUser');
  window.location.href = '/login';
};

// Auditoria de sessão (2026-08-02, S6): antes, qualquer 401 derrubava a sessão na hora,
// mesmo o access token tendo só 15min de vida e existindo um refresh token de longa
// duração. Agora tenta renovar uma vez antes de deslogar. isRefreshing + refreshSubscribers
// evitam que N requisições que falhem juntas (ex: várias queries do Dashboard) disparem
// N chamadas de refresh — só a primeira renova, as outras esperam e reusam o token novo.
//
// Auditoria de sessão persistente (2026-08-02): o `!response` no filtro abaixo é o que
// impede deslogar por erro de rede/timeout/servidor fora — sem resposta HTTP não há
// como afirmar que a sessão é inválida.
let isRefreshing = false;
let refreshSubscribers = [];

const subscribeTokenRefresh = (cb) => refreshSubscribers.push(cb);
const onRefreshed = (newToken) => {
  refreshSubscribers.forEach((cb) => cb(newToken));
  refreshSubscribers = [];
};

// Interceptor para tratamento de erros genéricos (ex: 401 Unauthorized)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;

    if (!response || response.status !== 401) {
      return Promise.reject(error);
    }

    const isAuthRoute = config.url.includes('/admin/login') || config.url.includes('/admin/refresh');
    if (isAuthRoute) {
      if (config.url.includes('/admin/refresh')) forceLogout();
      return Promise.reject(error);
    }

    // Já tentamos renovar uma vez para esta requisição e o token novo ainda voltou 401
    // (ex: admin foi desativado no meio da sessão) — não insistir num loop.
    if (config._retriedAfterRefresh) {
      forceLogout();
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem('adminRefreshToken');
    if (!refreshToken) {
      forceLogout();
      return Promise.reject(error);
    }

    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const { data } = await api.post('/admin/refresh', { refreshToken });
        localStorage.setItem('adminToken', data.token);
        localStorage.setItem('adminRefreshToken', data.refreshToken);
        isRefreshing = false;
        onRefreshed(data.token);
      } catch (refreshError) {
        isRefreshing = false;
        refreshSubscribers = [];
        forceLogout();
        return Promise.reject(error);
      }
    }

    return new Promise((resolve) => {
      subscribeTokenRefresh((newToken) => {
        config._retriedAfterRefresh = true;
        config.headers.Authorization = `Bearer ${newToken}`;
        resolve(api(config));
      });
    });
  }
);

export default api;
