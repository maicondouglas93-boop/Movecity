import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_BASE_URL,
    timeout: 10000, // 10s timeout
});

// Interceptor de Requisição: Injeta o token se existir
api.interceptors.request.use((config) => {
    // Tenta pegar o token do passageiro ou motorista
    const token = localStorage.getItem('token') || localStorage.getItem('captain-token');
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
        // Se a resposta for 401 Unauthorized, o token expirou ou é inválido.
        console.warn('Sessão expirada. Removendo tokens e redirecionando.');
        localStorage.removeItem('token');
        localStorage.removeItem('captain-token');
        
        // Redireciona para login (opcionalmente pode ser feito via roteador do React
        // mas window.location garante que o estado da memória seja limpo)
        window.location.href = '/login';
    }
    return Promise.reject(error);
});

export default api;
