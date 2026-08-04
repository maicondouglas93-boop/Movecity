import React, { useContext, useEffect, useState } from 'react'
import { SocketContext } from '@/shared/contexts/SocketContext'

// Faixa fixa de status de conexão — item 3/4 do relatório de UX: hoje o app do
// passageiro não tem NENHUMA indicação visual de "sem internet" ou "o socket caiu",
// então eventos em tempo real (motorista aceitou, chegou, chat) param de chegar sem
// nenhum aviso. Ainda não é montada em nenhuma tela (isso acontece na Etapa 2, junto
// de Home.jsx) — aqui só o componente, autocontido e sem efeito colateral até ser usado.
const ConnectionBanner = () => {
    const { socket } = useContext(SocketContext)
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    const [socketConnected, setSocketConnected] = useState(socket?.connected ?? true)

    useEffect(() => {
        const handleOnline = () => setIsOnline(true)
        const handleOffline = () => setIsOnline(false)
        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)
        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [])

    useEffect(() => {
        if (!socket) return
        const handleConnect = () => setSocketConnected(true)
        const handleDisconnect = () => setSocketConnected(false)
        socket.on('connect', handleConnect)
        socket.on('disconnect', handleDisconnect)
        return () => {
            socket.off('connect', handleConnect)
            socket.off('disconnect', handleDisconnect)
        }
    }, [socket])

    if (isOnline && socketConnected) return null

    const message = !isOnline ? 'Sem conexão com a internet' : 'Reconectando...'
    const tone = !isOnline ? 'bg-danger-500' : 'bg-amber-500'

    return (
        <div
            role="status"
            className={`fixed top-0 left-0 w-full z-overlay ${tone} text-white text-sm font-semibold text-center py-2 flex items-center justify-center gap-2`}
        >
            {isOnline && <i className="ri-loader-4-line animate-spin" aria-hidden="true" />}
            {message}
        </div>
    )
}

export default ConnectionBanner
