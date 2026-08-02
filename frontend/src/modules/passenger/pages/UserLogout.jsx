import React, { useEffect } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { getAccessToken, getRefreshToken, clearSession } from '@/services/session'
import SessionSplash from '@/shared/components/ui/SessionSplash'

// Auditoria de autenticação e sessão persistente (2026-08-02).
//
// Três problemas corrigidos aqui:
// 1. A chamada rodava no corpo do componente (não num useEffect) — em StrictMode isso
//    dispara duas vezes, e a cada re-render.
// 2. Sem `.catch()`: se o request falhasse, o usuário ficava preso numa tela escrito
//    "UserLogout" para sempre, ainda logado. Sair é uma ação explícita — tem que
//    funcionar mesmo se o servidor não responder.
// 3. Não enviava o refresh token, então a sessão de longa duração sobrevivia ao logout.
//
// Usa axios puro de propósito (não a instância com interceptor): um 401 aqui não deve
// disparar renovação silenciosa — estamos justamente encerrando a sessão.
export const UserLogout = () => {
    const navigate = useNavigate()

    useEffect(() => {
        const token = getAccessToken('user')
        const refreshToken = getRefreshToken('user')

        axios.get(`${import.meta.env.VITE_BASE_URL}/users/logout`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            params: refreshToken ? { refreshToken } : {},
            withCredentials: true,
        })
            .catch(() => {
                // Falha ao avisar o servidor não pode impedir o usuário de sair do
                // aplicativo. A sessão local é limpa de qualquer forma; o refresh token
                // continua revogável pelo servidor depois.
            })
            .finally(() => {
                clearSession('user')
                navigate('/login', { replace: true })
            })
    }, [])

    return <SessionSplash label="Saindo..." />
}

export default UserLogout
