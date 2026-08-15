import axios from 'axios';

let adminAccessToken = null;

// O painel antigo persistia ambos os tokens. Eles são descartados no primeiro boot;
// como a versão antiga nunca criava cookie de refresh, esse admin faz login uma vez.
if (typeof localStorage !== 'undefined') {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminRefreshToken');
}

export const setAdminAccessToken = (token) => {
  adminAccessToken = token || null;
};

export const getAdminAccessToken = () => adminAccessToken;

export const clearAdminSession = () => {
  adminAccessToken = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminRefreshToken');
  }
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  timeout: 10000,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (adminAccessToken && !config.headers?.Authorization) {
    config.headers.Authorization = `Bearer ${adminAccessToken}`;
  }
  return config;
}, (error) => Promise.reject(error));

const forceLogout = () => {
  clearAdminSession();
  localStorage.removeItem('adminUser');
  if (window.location.pathname !== '/login') window.location.href = '/login';
};

let refreshPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;

    // Rede/timeout/5xx não prova que a sessão acabou.
    if (!response || response.status !== 401) return Promise.reject(error);

    const url = config?.url || '';
    const isLogin = url.includes('/admin/login');
    const isRefresh = url.includes('/admin/refresh');
    if (isLogin) return Promise.reject(error);
    if (isRefresh || config?._retriedAfterRefresh) {
      forceLogout();
      return Promise.reject(error);
    }

    try {
      if (!refreshPromise) {
        refreshPromise = api.post('/admin/refresh', {}).then(({ data }) => {
          setAdminAccessToken(data.token);
          return data.token;
        }).finally(() => {
          refreshPromise = null;
        });
      }

      const newToken = await refreshPromise;
      config._retriedAfterRefresh = true;
      config.headers.Authorization = `Bearer ${newToken}`;
      return api(config);
    } catch (refreshError) {
      if (refreshError.response?.status === 401 || refreshError.response?.status === 403) {
        forceLogout();
      }
      return Promise.reject(refreshError);
    }
  }
);

export default api;
