import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext();

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const { user } = useAuth();

  useEffect(() => {
    // Only connect if user is logged in
    if (user) {
      const newSocket = io(import.meta.env.VITE_API_URL || 'http://localhost:3000', {
        transports: ['websocket'],
      });

      newSocket.on('connect', () => {
        console.log('Connected to socket', newSocket.id);
        // Join admin room (token exigido pelo backend — ver socket.js, S1 da auditoria)
        newSocket.emit('join', { userId: user._id, userType: 'admin', token: localStorage.getItem('adminToken') });
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
