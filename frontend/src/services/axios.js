import axios from 'axios';
import { getFriendlyErrorMessage } from './errorMessages';

const api = axios.create({
    baseURL: import.meta.env.VITE_BASE_URL,
    timeout: 10000, // 10s timeout
});

// Interceptor de Requisição: Injeta o token se existir
api.interceptors.request.use((config) => {
    // Escolhe o token com base na rota para evitar conflitos em testes na mesma máquina
    let token = null;
    const url = config.url || '';
    if (url.includes('/captains')) {
        token = localStorage.getItem('captain-token');
    } else if (url.includes('/users')) {
        token = localStorage.getItem('token');
    } else {
        token = localStorage.getItem('token') || localStorage.getItem('captain-token');
    }

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

// Interceptor de Resposta: Trata erros de autenticação globais
api.interceptors.response.use((response) => {
    return response;
}, (error) => {
    if (error.response && error.response.status === 401) {
        console.warn('Sessão expirada. Removendo tokens e redirecionando.');
        const url = error.config?.url || '';
        if (url.includes('/captains')) {
            localStorage.removeItem('captain-token');
            window.location.href = '/captain-login';
        } else if (url.includes('/users')) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        } else {
            localStorage.removeItem('token');
            localStorage.removeItem('captain-token');
            window.location.href = '/login';
        }
    }
    // Mensagem pronta pra qualquer chamador que só quer exibir algo amigável, sem
    // reimplementar a distinção timeout/rede/5xx/mensagem-do-backend em cada catch
    // (item 17 da auditoria de UX — ver frontend/src/services/errorMessages.js).
    error.friendlyMessage = getFriendlyErrorMessage(error);
    return Promise.reject(error);
});

export default api;
