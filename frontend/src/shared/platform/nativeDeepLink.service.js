import { isNativePlatform } from '@/shared/platform/platform'
import { consumeNativeDeepLink } from '@/shared/platform/nativeSession.service'

/**
 * Consome deep links nativos (intent extra / pós-aceite) e navega.
 * navigate(pathWithSearch) — ex.: '/captain-riding'
 */
export async function bindNativeDeepLinks(navigate) {
    if (!isNativePlatform() || typeof navigate !== 'function') {
        return () => {}
    }

    const go = (raw) => {
        if (!raw) return
        try {
            if (raw.startsWith('http://') || raw.startsWith('https://')) {
                const url = new URL(raw)
                navigate(`${url.pathname}${url.search}`)
                return
            }
            const path = raw.startsWith('/') ? raw : `/${raw}`
            navigate(path)
        } catch {
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
