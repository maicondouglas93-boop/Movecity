import React, { useContext, useEffect } from 'react'
import api from '@/shared/services/axios'
import { useNavigate } from 'react-router-dom'
import { getRefreshToken, clearSession } from '@/shared/services/session'
import { clearTokenInSW } from '@/shared/services/swCommunication'
import { unregisterPush } from '@/shared/platform/notification.service'
import { stopForegroundTracking } from '@/shared/platform/location.service'
import { SocketContext } from '@/shared/contexts/SocketContext'
import SessionSplash from '@/shared/components/ui/SessionSplash'

// Auditoria de autenticação e sessão persistente (2026-08-02).
// Ver o comentário equivalente em UserLogout.jsx — os mesmos três problemas existiam
// aqui (chamada fora de useEffect, sem catch, sem revogar o refresh token).
export const CaptainLogout = () => {
    const navigate = useNavigate()
    const { socket } = useContext(SocketContext)

    useEffect(() => {
        const refreshToken = getRefreshToken('captain')

        // A3 da auditoria de push (2026-08-02): sem isto, o próximo motorista a usar o
        // mesmo aparelho continuaria recebendo ofertas de corrida de quem saiu.
        Promise.all([
            unregisterPush().catch(() => {}),
            stopForegroundTracking().catch(() => {}),
            api.get('/captains/logout', {
                params: refreshToken ? { refreshToken } : {},
            }).catch(() => {
                // Sair não pode depender do servidor responder.
            })
        ]).finally(() => {
            clearTokenInSW()
            clearSession('captain')
            // Auditoria PWA (2026-08-03, A6): ver comentário equivalente em
            // UserLogout.jsx — sem isto, um segundo motorista logando na mesma aba
            // (aparelho de frota compartilhado) podia reusar a conexão de socket do
            // motorista anterior.
            socket.disconnect()
            socket.connect()
            navigate('/captain-login', { replace: true })
        })
    }, [])

    return <SessionSplash label="Saindo..." />
}

export default CaptainLogout
