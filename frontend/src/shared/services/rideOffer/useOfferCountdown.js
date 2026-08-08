import { useEffect, useState } from 'react'

const TICK_MS = 250

// Auditoria PWA (2026-08-07, P1/P6): contador SEMPRE recalculado a partir de
// offerExpiresAt (vindo do backend — mesma âncora usada no socket/FCM/pull),
// nunca de um timer local que só conta pra baixo cego. Isso é o que faz Socket,
// FCM e PWA mostrarem o mesmo tempo restante para a mesma oferta, e o que
// corrige o valor sozinho quando a aba volta de segundo plano (onde o
// navegador atrasa/pausa setInterval).
export function useOfferCountdown(offerExpiresAt) {
    const targetMs = offerExpiresAt ? new Date(offerExpiresAt).getTime() : null
    const [remainingMs, setRemainingMs] = useState(() => (
        targetMs != null ? Math.max(0, targetMs - Date.now()) : null
    ))

    useEffect(() => {
        if (targetMs == null) {
            setRemainingMs(null)
            return undefined
        }
        const tick = () => setRemainingMs(Math.max(0, targetMs - Date.now()))
        tick()
        const intervalId = window.setInterval(tick, TICK_MS)
        const onVisible = () => {
            if (document.visibilityState === 'visible') tick()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', tick)
        return () => {
            window.clearInterval(intervalId)
            document.removeEventListener('visibilitychange', onVisible)
            window.removeEventListener('focus', tick)
        }
    }, [targetMs])

    return {
        remainingMs,
        remainingSeconds: remainingMs != null ? Math.ceil(remainingMs / 1000) : null,
        expired: targetMs != null && remainingMs === 0,
    }
}
