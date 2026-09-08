import { useContext, useEffect, useState } from 'react'
import { SocketContext } from '@/shared/contexts/SocketContext'

// Conectividade não altera a sessão nem a escolha de disponibilidade.
export default function useConnectionState() {
    const { socket } = useContext(SocketContext)
    const [internet, setInternet] = useState(() => navigator.onLine !== false)
    const [connectedSocket, setConnectedSocket] = useState(() => socket?.connected ? socket : null)
    useEffect(() => {
        const online = () => setInternet(true)
        const offline = () => setInternet(false)
        window.addEventListener('online', online)
        window.addEventListener('offline', offline)
        return () => {
            window.removeEventListener('online', online)
            window.removeEventListener('offline', offline)
        }
    }, [])
    useEffect(() => {
        setConnectedSocket(socket?.connected ? socket : null)
        const connect = () => setConnectedSocket(socket)
        const disconnect = () => setConnectedSocket(null)
        socket?.on('connect', connect)
        socket?.on('disconnect', disconnect)
        return () => {
            socket?.off('connect', connect)
            socket?.off('disconnect', disconnect)
        }
    }, [socket])
    return { internet, connected: Boolean(socket && connectedSocket === socket) }
}
