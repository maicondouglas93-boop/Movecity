import React, { useContext, useEffect, useState } from 'react'
import { UserDataContext } from '@/contexts/UserContext'
import { useNavigate } from 'react-router-dom'
import api from '@/services/axios'
import { getAccessToken, getRefreshToken } from '@/services/session'
import SessionSplash from '@/shared/components/ui/SessionSplash'
import Button from '@/shared/components/ui/Button'

// Auditoria de autenticação e sessão persistente (2026-08-02).
//
// Antes, o `.catch()` era genérico: QUALQUER falha ao buscar o perfil — timeout de 10s,
// queda de rede, 500 do backend, backend hibernando no free tier — apagava o token e
// mandava o usuário pro login. Era a causa mais provável de gente ser deslogada "do
// nada" sem nunca ter clicado em Sair.
//
// Agora: 401/403 (sessão comprovadamente inválida) é o ÚNICO caso que encerra a sessão —
// e mesmo o 401 só chega aqui depois de o interceptor ter tentado renovar
// silenciosamente. Erro de rede/servidor mantém a sessão e oferece "Tentar de novo".
const UserProtectWrapper = ({ children }) => {
    const navigate = useNavigate()
    const { setUser } = useContext(UserDataContext)
    const [ status, setStatus ] = useState('checking') // checking | authenticated | network-error
    const [ attempt, setAttempt ] = useState(0)

    useEffect(() => {
        let cancelled = false

        // Sem nenhum vestígio de sessão, nem tenta o request: vai direto pro login,
        // sem piscar a interface autenticada.
        if (!getAccessToken('user') && !getRefreshToken('user')) {
            navigate('/login', { replace: true })
            return
        }

        setStatus('checking')
        api.get('/users/profile')
            .then(response => {
                if (cancelled) return
                setUser(response.data)
                setStatus('authenticated')
            })
            .catch(err => {
                if (cancelled) return
                const code = err.response?.status
                if (code === 401 || code === 403) {
                    // O interceptor já tentou renovar, já limpou a sessão e já
                    // redireciona. Não duplicamos a limpeza aqui.
                    return
                }
                // Rede, timeout, 5xx: a sessão continua válida — só não deu pra confirmar agora.
                setStatus('network-error')
            })

        return () => { cancelled = true }
    }, [ attempt ])

    if (status === 'checking') {
        return <SessionSplash label="Entrando..." />
    }

    if (status === 'network-error') {
        return (
            <div className="h-screen w-full bg-surface flex flex-col items-center justify-center gap-4 px-8 text-center">
                <i className="ri-wifi-off-line text-4xl text-ink-400" aria-hidden="true"></i>
                <div>
                    <h1 className="text-lg font-semibold text-ink-900 mb-1">Sem conexão com o servidor</h1>
                    <p className="text-sm text-ink-600">Você continua logado. Verifique sua internet e tente novamente.</p>
                </div>
                <Button onClick={() => setAttempt(n => n + 1)} className="max-w-xs">Tentar de novo</Button>
            </div>
        )
    }

    return <>{children}</>
}

export default UserProtectWrapper
