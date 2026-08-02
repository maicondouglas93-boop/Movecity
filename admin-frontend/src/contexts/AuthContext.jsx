import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Auditoria de sessão persistente (2026-08-02, achado A1): antes isto lia o
  // localStorage e considerava o admin autenticado sem perguntar nada ao servidor —
  // um admin desativado ou com a sessão revogada via a UI completa até a primeira
  // chamada falhar. Agora confirma contra GET /admin/me antes de liberar a interface.
  //
  // O interceptor de api.js já renova o access token silenciosamente se ele tiver
  // expirado, então "abrir o painel dias depois" cai aqui, renova e segue autenticado.
  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      const storedToken = localStorage.getItem('adminToken');
      const storedRefresh = localStorage.getItem('adminRefreshToken');

      if (!storedToken && !storedRefresh) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Mostra imediatamente o que está em cache pra não piscar a tela de login
      // enquanto a confirmação vai e volta; o valor é substituído pelo do servidor
      // logo em seguida (ou a sessão é descartada, se for inválida).
      const storedUser = localStorage.getItem('adminUser');
      if (storedUser && !cancelled) {
        try { setUser(JSON.parse(storedUser)); } catch { /* json corrompido, ignora */ }
      }

      try {
        const { data } = await api.get('/admin/me');
        if (cancelled) return;
        localStorage.setItem('adminUser', JSON.stringify(data.admin));
        setUser(data.admin);
      } catch (err) {
        if (cancelled) return;
        // Rede/servidor fora: mantém o que estava em cache — não desloga por
        // instabilidade. Só encerra se o servidor disser explicitamente que a sessão
        // não vale mais (e nesse caso o interceptor já limpou tudo e redirecionou).
        const status = err.response?.status;
        if (status === 401 || status === 403) {
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    restoreSession();
    return () => { cancelled = true; };
  }, []);

  const login = async (email, password) => {
    try {
      const response = await api.post('/admin/login', { email, password });
      const { admin, token, refreshToken } = response.data;

      localStorage.setItem('adminToken', token);
      // Auditoria de sessão (2026-08-02, S6): antes o refresh token vinha na resposta
      // do login e era descartado — sem ele guardado, não tinha como renovar o access
      // token depois de 15min, e a sessão morria com reload duro no meio do trabalho.
      localStorage.setItem('adminRefreshToken', refreshToken);
      localStorage.setItem('adminUser', JSON.stringify(admin));

      setUser(admin);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Erro ao realizar login'
      };
    }
  };

  const logout = async () => {
    try {
      // Envia o refresh token pro backend revogar só esta sessão (sem ele, o backend
      // encerra todas as sessões deste admin — ver invalidateRefreshToken).
      await api.post('/admin/logout', { refreshToken: localStorage.getItem('adminRefreshToken') });
    } catch (e) {
      console.error('Logout error', e);
    } finally {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminRefreshToken');
      localStorage.removeItem('adminUser');
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
