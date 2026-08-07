import { isNativePlatform } from '@/shared/platform/platform'
import { consumeNativeDeepLink } from '@/shared/platform/nativeSession.service'

/**
 * Consome deep links nativos (intent extra / pós-aceite) e navega.
 * Pós-aceite (status accepted): '/captain-home' → ConfirmRidePopUp.
 * Corrida já iniciada: '/captain-riding' (via RideContext quando status=started).
 */
export async function bindNativeDeepLinks(navigate) {
    if (!isNativePlatform() || typeof navigate !== 'function') {
        return () => {}
    }

    const go = (raw) => {
        if (!raw) return
        try {
            let target
            if (raw.startsWith('http://') || raw.startsWith('https://')) {
                const url = new URL(raw)
                target = `${url.pathname}${url.search}`
            } else {
                target = raw.startsWith('/') ? raw : `/${raw}`
            }
            console.info(`[RideOfferFlow] DEEP_LINK_CONSUMED | ${target}`)
            console.info(`[RideOfferFlow] NAVIGATION_TARGET | ${target}`)
            navigate(target)
        } catch {
            console.info('[RideOfferFlow] NAVIGATION_TARGET | /captain-home (fallback)')
            navigate('/captain-home')
        }
    }

    // Cold start / intent pendente
    const pending = await consumeNativeDeepLink()
    if (pending) go(pending)

    // App volta ao foreground com novo intent (MainActivity onNewIntent)
    let unsubActive = () => {}
    try {
        const { onAppActive } = await import('@/shared/platform/appLifecycle.service')
        unsubActive = onAppActive(async () => {
            const next = await consumeNativeDeepLink()
            if (next) go(next)
        })
    } catch {
        /* ignore */
    }

    return () => {
        unsubActive?.()
    }
}
