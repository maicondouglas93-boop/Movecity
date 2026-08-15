import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { getAdminAccessToken } from '../services/api';

const SocketContext = createContext();

// Fase 1 da auditoria de production readiness (C3, 2026-08-05): VITE_API_URL aponta
// para a base REST com sufixo /api (ex: https://movecity.onrender.com/api). Passar
// essa URL direto pro io() fazia o Socket.IO tratar /api como namespace e o handshake
// continuava indo para /socket.io na origin — mas qualquer path real na URL quebraria
// o namespace esperado pelo backend (que usa o default '/'). O socket conecta na
// ORIGIN do backend; a API REST continua usando VITE_API_URL com /api normalmente.
// VITE_SOCKET_URL permite apontar o socket para outro host se um dia divergirem.
export function resolveSocketUrl(env = import.meta.env) {
  const explicit = env.VITE_SOCKET_URL;
  if (explicit) return explicit;
  const apiUrl = env.VITE_API_URL || 'http://localhost:3000';
  try {
    return new URL(apiUrl).origin;
  } catch {
    return apiUrl;
  }
}

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    // Only connect if user is logged in
    if (user) {
      // Fase 3 (2026-08-05, item 13 da auditoria): só 'websocket' derrubava o painel
      // em redes corporativas/proxies que bloqueiam WS — mesmo padrão do app do
      // passageiro/motorista: conecta por polling e faz upgrade pra WebSocket sozinho.
      const newSocket = io(resolveSocketUrl(), {
        transports: ['polling', 'websocket'],
      });

      newSocket.on('connect', () => {
        console.log('Connected to socket', newSocket.id);
        // Join admin room (token exigido pelo backend — ver socket.js, S1 da auditoria)
        newSocket.emit('join', { userId: user._id, userType: 'admin', token: getAdminAccessToken() });
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    } else if (socket) {
      socket.disconnect();
      setSocket(null);
    }
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
