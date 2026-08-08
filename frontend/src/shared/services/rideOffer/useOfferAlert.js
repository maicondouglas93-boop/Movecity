import { useEffect, useRef } from 'react'
import { vibrate } from '@/shared/platform/haptics.service'

const VIBRATE_PATTERN = [500, 200, 500]
const VIBRATE_REPEAT_MS = 3000

// Auditoria PWA (2026-08-07, P6): antes, o som tocava uma vez só (sem loop) e
// não havia nada que parasse a vibração porque ela também era single-shot —
// não tinha o que "parar" de verdade. Agora insiste (som em loop + vibração
// reforçada a cada 3s) enquanto offerId não mudar, e para IMEDIATAMENTE assim
// que a oferta em destaque muda ou é resolvida (o cleanup do effect cobre
// aceitar/recusar/expirar/troca de oferta — todos mudam offerId ou zeram).
export function useOfferAlert(offerId) {
    const audioRef = useRef(null)

    useEffect(() => {
        if (!offerId) return undefined

        const audio = new Audio('/sounds/new-ride.wav')
        audio.loop = true
        audioRef.current = audio
        audio.play().catch((err) => {
            // Autoplay bloqueado (sem gesto prévio na aba) — falha silenciosa de
            // propósito, o modal + vibração (quando suportada) ainda funcionam.
            console.warn('[OfferAlert] autoplay bloqueado:', err?.message || err)
        })

        vibrate(VIBRATE_PATTERN)
        const vibrateIntervalId = window.setInterval(() => {
            vibrate(VIBRATE_PATTERN)
        }, VIBRATE_REPEAT_MS)

        return () => {
            audio.pause()
            audio.currentTime = 0
            audioRef.current = null
            window.clearInterval(vibrateIntervalId)
        }
    }, [offerId])
}
