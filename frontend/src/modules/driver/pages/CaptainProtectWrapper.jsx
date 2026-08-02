import React, { useContext, useEffect, useState } from 'react'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { useNavigate } from 'react-router-dom'
import api from '@/services/axios'
import { getAccessToken, getRefreshToken } from '@/services/session'
import SessionSplash from '@/shared/components/ui/SessionSplash'
import Button from '@/shared/components/ui/Button'

// Auditoria de autenticação e sessão persistente (2026-08-02).
// Mesmo raciocínio de UserProtectWrapper — e aqui o impacto era ainda pior: um
// motorista perdendo a sessão por instabilidade de rede no meio de uma corrida.
const CaptainProtectWrapper = ({ children }) => {
    const navigate = useNavigate()
    const { setCaptain } = useContext(CaptainDataContext)
    const [ status, setStatus ] = useState('checking') // checking | authenticated | network-error
    const [ attempt, setAttempt ] = useState(0)

    useEffect(() => {
        let cancelled = false

        if (!getAccessToken('captain') && !getRefreshToken('captain')) {
            navigate('/captain-login', { replace: true })
            return
        }

        setStatus('checking')
        api.get('/captains/profile')
            .then(response => {
                if (cancelled) return
                setCaptain(response.data.captain)
                setStatus('authenticated')
            })
            .catch(err => {
                if (cancelled) return
                const code = err.response?.status
                if (code === 401 || code === 403) {
                    // Interceptor já cuidou (renovou ou encerrou a sessão e redirecionou).
                    return
                }
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

export default CaptainProtectWrapper
