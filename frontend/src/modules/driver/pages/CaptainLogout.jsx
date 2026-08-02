import React, { useEffect } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { getAccessToken, getRefreshToken, clearSession } from '@/services/session'
import SessionSplash from '@/shared/components/ui/SessionSplash'

// Auditoria de autenticação e sessão persistente (2026-08-02).
// Ver o comentário equivalente em UserLogout.jsx — os mesmos três problemas existiam
// aqui (chamada fora de useEffect, sem catch, sem revogar o refresh token).
export const CaptainLogout = () => {
    const navigate = useNavigate()

    useEffect(() => {
        const token = getAccessToken('captain')
        const refreshToken = getRefreshToken('captain')

        axios.get(`${import.meta.env.VITE_BASE_URL}/captains/logout`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            params: refreshToken ? { refreshToken } : {},
            withCredentials: true,
        })
            .catch(() => {
                // Sair não pode depender do servidor responder.
            })
            .finally(() => {
                clearSession('captain')
                navigate('/captain-login', { replace: true })
            })
    }, [])

    return <SessionSplash label="Saindo..." />
}

export default CaptainLogout
