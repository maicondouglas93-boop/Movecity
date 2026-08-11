import { registerPlugin } from '@capacitor/core'
import { isNativePlatform } from '@/shared/platform/platform'
import { onAppActive } from '@/shared/platform/appLifecycle.service'

const PassengerDeepLink = registerPlugin('PassengerDeepLink')

const ALLOWED_PASSENGER_PATHS = new Set([
    '/home',
    '/riding',
    '/scheduled',
    '/encomenda/ativa',
    '/wallet',
    '/coupons',
    '/activity',
    '/profile',
    '/notifications',
])

/** Normaliza um payload para uma rota interna e rejeita rotas do Motorista. */
export function normalizePassengerDeepLink(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null
    try {
        const value = raw.trim()
        const url = new URL(value, 'https://localhost')
        if (!ALLOWED_PASSENGER_PATHS.has(url.pathname)) return null
        return `${url.pathname}${url.search}`
    } catch {
        return null
    }
}

async function consumePending() {
    try {
        const result = await PassengerDeepLink.consumePending()
        return normalizePassengerDeepLink(result?.deepLink)
    } catch (err) {
        console.warn('[passengerDeepLink] consume falhou:', err?.message || err)
        return null
    }
}

/**
 * Cold start, retorno ao foreground e onNewIntent ativo usam o mesmo consumo
 * one-shot comprovado no Motorista, com allowlist própria do Passageiro.
 */
export async function bindPassengerNativeDeepLinks(navigate) {
    if (!isNativePlatform() || typeof navigate !== 'function') return () => {}

    let disposed = false
    const consumeAndNavigate = async () => {
        const next = await consumePending()
        if (!disposed && next) navigate(next)
    }

    await consumeAndNavigate()
    const removeLifecycle = onAppActive(consumeAndNavigate)
    const eventHandle = await PassengerDeepLink.addListener(
        'deepLinkAvailable',
        consumeAndNavigate
    )

    return () => {
        disposed = true
        removeLifecycle?.()
        eventHandle?.remove?.()
    }
}
