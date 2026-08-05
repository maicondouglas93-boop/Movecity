import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

// Heads-up (2026-08-04): o Service Worker de push, ao focar uma janela já aberta,
// manda NOTIFICATION_NAVIGATE com a URL do deep link (ex.: /captain-home?rideOffer=…).
// Sem este listener, o focus acontecia mas a rota não mudava — o motorista via a
// tela antiga em vez da oferta.
const NotificationNavigateListener = () => {
    const navigate = useNavigate()

    useEffect(() => {
        if (!('serviceWorker' in navigator)) return undefined

        // Fase 3 (M1, 2026-08-05): o fallback de 250ms era um setTimeout sem dono —
        // desmontar o listener no meio da janela deixava um window.location.assign
        // pendente disparar depois.
        let fallbackTimer = null

        const onMessage = (event) => {
            if (event.data?.type !== 'NOTIFICATION_NAVIGATE' || !event.data.url) return
            try {
                const target = new URL(event.data.url, window.location.origin)
                if (target.origin !== window.location.origin) return
                const next = `${target.pathname}${target.search}${target.hash}`
                const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
                if (next === current) return
                // navigate (SPA) primeiro; se a rota não mudar (edge case), força assign.
                navigate(next)
                if (fallbackTimer) window.clearTimeout(fallbackTimer)
                fallbackTimer = window.setTimeout(() => {
                    const after = `${window.location.pathname}${window.location.search}${window.location.hash}`
                    if (after !== next) {
                        window.location.assign(next)
                    }
                }, 250)
            } catch (err) {
                console.warn('Deep link da notificação inválido:', err)
            }
        }

        navigator.serviceWorker.addEventListener('message', onMessage)
        return () => {
            navigator.serviceWorker.removeEventListener('message', onMessage)
            if (fallbackTimer) window.clearTimeout(fallbackTimer)
        }
    }, [navigate])

    return null
}

export default NotificationNavigateListener
