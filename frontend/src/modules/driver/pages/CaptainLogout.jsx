import React, { useEffect } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { getAccessToken, getRefreshToken, clearSession } from '@/services/session'
import { clearTokenInSW } from '@/services/swCommunication'
import { getCurrentFcmToken } from '@/services/fcm'
import SessionSplash from '@/shared/components/ui/SessionSplash'

// Auditoria de autenticação e sessão persistente (2026-08-02).
// Ver o comentário equivalente em UserLogout.jsx — os mesmos três problemas existiam
// aqui (chamada fora de useEffect, sem catch, sem revogar o refresh token).
export const CaptainLogout = () => {
    const navigate = useNavigate()

    useEffect(() => {
        const token = getAccessToken('captain')
        const refreshToken = getRefreshToken('captain')

        // A3 da auditoria de push (2026-08-02): sem isto, o próximo motorista a usar o
        // mesmo aparelho continuaria recebendo ofertas de corrida de quem saiu.
        const unregisterPushToken = async () => {
            try {
                const fcmToken = await getCurrentFcmToken()
                if (fcmToken && token) {
                    await axios.delete(`${import.meta.env.VITE_BASE_URL}/notifications/token`, {
                        headers: { Authorization: `Bearer ${token}` },
                        params: { token: fcmToken },
                        withCredentials: true,
                    })
                }
            } catch {
                // Sair não pode depender disso funcionar.
            }
        }

        Promise.all([
            unregisterPushToken(),
            axios.get(`${import.meta.env.VITE_BASE_URL}/captains/logout`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                params: refreshToken ? { refreshToken } : {},
                withCredentials: true,
            }).catch(() => {
                // Sair não pode depender do servidor responder.
            })
        ]).finally(() => {
            clearTokenInSW()
            clearSession('captain')
            navigate('/captain-login', { replace: true })
        })
    }, [])

    return <SessionSplash label="Saindo..." />
}

export default CaptainLogout
