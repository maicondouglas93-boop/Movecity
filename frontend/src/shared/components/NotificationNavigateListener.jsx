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

        const onMessage = (event) => {
            if (event.data?.type !== 'NOTIFICATION_NAVIGATE' || !event.data.url) return
            try {
                const target = new URL(event.data.url, window.location.origin)
                if (target.origin !== window.location.origin) return
                navigate(`${target.pathname}${target.search}${target.hash}`)
            } catch (err) {
                console.warn('Deep link da notificação inválido:', err)
            }
        }

        navigator.serviceWorker.addEventListener('message', onMessage)
        return () => navigator.serviceWorker.removeEventListener('message', onMessage)
    }, [navigate])

    return null
}

export default NotificationNavigateListener
