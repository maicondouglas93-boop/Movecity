import { registerPlugin } from '@capacitor/core'
import { isNativePlatform } from '@/shared/platform/platform'
import { getAccessToken, getRefreshToken } from '@/shared/services/session'

const NativeSession = registerPlugin('NativeSession')

/**
 * Espelha JWT + refresh + base URL no SharedPreferences nativo para
 * Aceitar corrida/encomenda com o app morto.
 */
export async function syncNativeCaptainSession({ token, refreshToken } = {}) {
    if (!isNativePlatform()) return
    try {
        const apiBase = import.meta.env.VITE_BASE_URL || ''
        const access = token || getAccessToken('captain')
        const refresh = refreshToken || getRefreshToken('captain')
        if (access) {
            await NativeSession.save({
                token: access,
                refreshToken: refresh || '',
                apiBase,
            })
        } else {
            await NativeSession.clear()
        }
    } catch (err) {
        console.warn('[nativeSession] sync failed:', err?.message || err)
    }
}

export async function clearNativeCaptainSession() {
    if (!isNativePlatform()) return
    try {
        await NativeSession.clear()
    } catch (err) {
        console.warn('[nativeSession] clear failed:', err?.message || err)
    }
}

/** Consome deep link pendente gravado pelo nativo (push / pós-aceite). */
export async function consumeNativeDeepLink() {
    if (!isNativePlatform()) return null
    try {
        const result = await NativeSession.consumePendingDeepLink()
        return result?.deepLink || null
    } catch (err) {
        console.warn('[nativeSession] consumeDeepLink failed:', err?.message || err)
        return null
    }
}
