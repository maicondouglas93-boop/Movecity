
import React, { createContext, useEffect } from 'react'
import { io } from 'socket.io-client';

export const SocketContext = createContext();

import * as Sentry from '@sentry/react';
import { replayOfflineActions, actionLabel } from '@/services/offlineQueue';
import { useToast } from '@/contexts/ToastContext';

const socket = io(`${import.meta.env.VITE_BASE_URL}`, {
    transports: [ 'polling' ]
});

const SocketProvider = ({ children }) => {
    const { addToast } = useToast()

    useEffect(() => {
        socket.on('connect', () => {
            console.log('Connected to server');
            syncOfflineQueue();
        });

        socket.on('disconnect', (reason) => {
            console.log('Disconnected from server', reason);
            Sentry.captureMessage(`Socket disconnected: ${reason}`, 'warning');
        });

        // Reexecuta a fila de ações offline via HTTP (P1.2 da auditoria de concorrência,
        // 2026-08-02) — só sai da fila com uma resposta real do servidor. Antes disso, as
        // ações eram emitidas como evento de socket sem handler no backend e apagadas na
        // hora, sem nenhuma confirmação (item O1 da auditoria).
        const syncOfflineQueue = async () => {
            try {
                await replayOfflineActions({
                    onResolved: (action) => {
                        addToast(`Confirmado: ${actionLabel(action.type)}.`, 'success')
                    },
                    onAlreadyApplied: (action) => {
                        addToast(`Já confirmado anteriormente: ${actionLabel(action.type)}.`, 'info')
                    },
                    onPermanentFailure: (action, err) => {
                        addToast(
                            `Não foi possível ${actionLabel(action.type)}. ${err.response?.data?.message || 'Verifique o histórico da corrida.'}`,
                            'error',
                            8000
                        )
                    },
                    // onRetryLater: rede ainda instável, tenta de novo na próxima reconexão
                    // sem incomodar o motorista a cada tentativa silenciosa.
                });
            } catch (err) {
                console.error('Failed to sync offline queue:', err);
                Sentry.captureException(err);
            }
        };

        window.addEventListener('online', syncOfflineQueue);

        return () => {
            window.removeEventListener('online', syncOfflineQueue);
        };
    }, [addToast]);
    return (
        <SocketContext.Provider value={{ socket }}>
            {children}
        </SocketContext.Provider>
    );
};

export default SocketProvider;
