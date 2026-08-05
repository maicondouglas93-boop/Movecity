
import React, { createContext, useEffect } from 'react'
import { io } from 'socket.io-client';

export const SocketContext = createContext();

import * as Sentry from '@sentry/react';
import { replayOfflineActions, actionLabel } from '@/shared/services/offlineQueue';
import { useToast } from '@/shared/contexts/ToastContext';

// Auditoria PWA (2026-08-03, A3): forçar só 'polling' nunca deixava o socket fazer
// upgrade pra WebSocket (o backend já aceita os dois — Backend/socket.js) — toda
// atualização em tempo real (localização, eventos de corrida, chat) usava requisições
// HTTP repetidas em vez de uma conexão persistente leve, gastando mais bateria e dados
// móveis em 100% das sessões. 'polling' continua listado primeiro como fallback — o
// socket.io-client tenta o upgrade automaticamente depois de conectar.
const socket = io(`${import.meta.env.VITE_BASE_URL}`, {
    transports: [ 'polling', 'websocket' ]
});

const SocketProvider = ({ children }) => {
    const { addToast } = useToast()

    useEffect(() => {
        // Fase 2 da auditoria de production readiness (H8, 2026-08-05): handlers
        // nomeados para poderem sair no cleanup. O socket é um singleton de módulo —
        // sem o off, cada remount do provider (StrictMode em dev, futura mudança de
        // árvore) empilhava mais um par de listeners, duplicando sync da fila offline
        // e spam de captureMessage a cada disconnect.
        const handleConnect = () => {
            console.log('Connected to server');
            syncOfflineQueue();
        };

        const handleDisconnect = (reason) => {
            console.log('Disconnected from server', reason);
            Sentry.captureMessage(`Socket disconnected: ${reason}`, 'warning');
        };

        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);

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
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
        };
    }, [addToast]);
    return (
        <SocketContext.Provider value={{ socket }}>
            {children}
        </SocketContext.Provider>
    );
};

export default SocketProvider;
