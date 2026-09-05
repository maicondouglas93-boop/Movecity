import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import { getAccessToken, getRefreshToken, LOGIN_ROUTE } from '@/shared/services/session'
import { onAppActive } from '@/shared/platform/appLifecycle.service'
import { withHardTimeout } from '@/shared/utils/hardTimeout'
import SessionSplash from '@/shared/components/ui/SessionSplash'
import Button from '@/shared/components/ui/Button'

const RETRY_DELAYS_MS = [2000, 5000, 10000, 15000]
const SLOW_NOTICE_MS = 1500
const STARTUP_GRACE_MS = 60000
const PROFILE_PATH = { user: '/users/profile', captain: '/captains/profile' }

// Somente a leitura do perfil é repetida. Ações de corrida/pagamento não ganham retries.
export default function SessionGuard({ kind, onAuthenticated, children }) {
    const navigate = useNavigate()
    const navigateRef = useRef(navigate)
    const [status, setStatus] = useState('checking')
    const [busy, setBusy] = useState(false)
    const retryRef = useRef(() => {})

    // Navegar entre rotas filhas não deve revalidar/desmontar o mapa já autenticado.
    useEffect(() => { navigateRef.current = navigate }, [navigate])

    useEffect(() => {
        let disposed = false
        let authenticated = false
        let terminal = false
        let inFlight = false
        let failures = 0
        let retryTimer
        let controller
        const startedAt = Date.now()

        const showConnectionState = () => {
            if (disposed || authenticated || terminal) return
            setStatus(navigator.onLine === false ? 'offline'
                : Date.now() - startedAt >= STARTUP_GRACE_MS ? 'unavailable' : 'connecting')
        }
        const slowTimer = setTimeout(showConnectionState, SLOW_NOTICE_MS)
        const graceTimer = setTimeout(showConnectionState, STARTUP_GRACE_MS)

        const check = async () => {
            if (disposed || authenticated || inFlight || terminal) return
            clearTimeout(retryTimer)
            if (!getAccessToken(kind) && !getRefreshToken(kind)) {
                terminal = true
                navigateRef.current(LOGIN_ROUTE[kind], { replace: true })
                return
            }
            // Aguarda online/retorno ao app; não gasta requisições em segundo plano.
            if (navigator.onLine === false) {
                setStatus('offline')
                return
            }
            if (document.visibilityState === 'hidden') return

            inFlight = true
            setBusy(true)
            if (failures || Date.now() - startedAt >= SLOW_NOTICE_MS) showConnectionState()
            controller = new AbortController()
            try {
                // Teto JS também cobre transportes nativos que ignoram timeout do Axios.
                const response = await withHardTimeout(api.get(PROFILE_PATH[kind], { signal: controller.signal }))
                if (disposed) return
                onAuthenticated(response.data)
                authenticated = true
                clearTimeout(slowTimer)
                clearTimeout(graceTimer)
                setStatus('authenticated')
            } catch (error) {
                if (disposed) return
                const code = error.response?.status
                if (code === 401) {
                    // O interceptor já tentou renovar; esta rejeição é definitiva.
                    terminal = true
                    navigateRef.current(LOGIN_ROUTE[kind], { replace: true })
                    return
                }
                if (code && code !== 408 && code !== 429 && code < 500) {
                    terminal = true
                    setStatus(code === 403 ? 'denied' : 'error')
                    return
                }
                showConnectionState()
                const delay = RETRY_DELAYS_MS[Math.min(failures++, RETRY_DELAYS_MS.length - 1)]
                retryTimer = setTimeout(check, delay)
            } finally {
                controller?.abort()
                inFlight = false
                if (!disposed) setBusy(false)
            }
        }

        const retry = () => {
            terminal = false
            void check()
        }
        const resume = () => { void check() }
        retryRef.current = retry
        window.addEventListener('online', resume)
        window.addEventListener('focus', resume)
        const stopAppActive = onAppActive(resume)
        void check()

        return () => {
            disposed = true
            retryRef.current = () => {}
            clearTimeout(retryTimer)
            clearTimeout(slowTimer)
            clearTimeout(graceTimer)
            controller?.abort()
            window.removeEventListener('online', resume)
            window.removeEventListener('focus', resume)
            stopAppActive()
        }
    }, [kind, onAuthenticated])

    if (status === 'authenticated') return children
    if (status === 'checking') return <SessionSplash label="Entrando..." />

    const messages = {
        connecting: ['Conectando ao servidor...', 'O servidor pode estar iniciando. Vamos tentar novamente automaticamente.'],
        unavailable: ['O servidor está demorando para responder', 'Sua sessão foi mantida. Continuamos tentando reconectar automaticamente.'],
        offline: ['Você está sem internet', 'Sua sessão foi mantida. Vamos tentar novamente quando a conexão voltar.'],
        denied: ['Não foi possível autorizar seu acesso', 'O servidor recusou o acesso à conta. Tente novamente ou entre em contato com o suporte.'],
        error: ['Não foi possível carregar sua conta', 'O servidor respondeu com um erro. Tente novamente em instantes.'],
    }
    const [title, description] = messages[status]
    return (
        <div className="h-screen w-full bg-surface flex flex-col items-center justify-center gap-4 px-8 text-center">
            <i className={`${status === 'offline' ? 'ri-wifi-off-line' : 'ri-cloud-line'} text-4xl text-ink-400`} aria-hidden="true" />
            <div role="status" aria-live="polite">
                <h1 className="text-lg font-semibold text-ink-900 mb-1">{title}</h1>
                <p className="text-sm text-ink-600">{description}</p>
            </div>
            <Button onClick={() => retryRef.current()} loading={busy} className="max-w-xs">
                {busy ? 'Conectando...' : 'Tentar de novo'}
            </Button>
        </div>
    )
}
