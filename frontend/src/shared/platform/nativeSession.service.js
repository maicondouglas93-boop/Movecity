import { registerPlugin } from '@capacitor/core'
import { isNativePlatform } from '@/shared/platform/platform'
import { getAccessToken, getRefreshToken, saveSession } from '@/shared/services/session'
import { withHardTimeout } from '@/shared/utils/hardTimeout'

const NativeSession = registerPlugin('NativeSession')
let pendingWrite = Promise.resolve()
const writeSession = (operation) => {
    const next = pendingWrite.catch(() => {}).then(operation)
    pendingWrite = next
    return next
}

/** Restaura antes dos guards e recupera rotações feitas pelo aceite nativo. */
export async function restoreNativeCaptainSession() {
    if (!isNativePlatform()) return
    const previousAccess = getAccessToken('captain')
    const previousRefresh = getRefreshToken('captain')
    const loggedOut = localStorage.getItem('captain-token:loggedOut')
    if (loggedOut) return
    try {
        await withHardTimeout(pendingWrite, 5000)
        const stored = await withHardTimeout(NativeSession.read(), 5000)
        // Login/logout ocorrido durante a leitura tem prioridade sobre a cópia.
        if (getAccessToken('captain') !== previousAccess
            || getRefreshToken('captain') !== previousRefresh
            || localStorage.getItem('captain-token:loggedOut')) return
        if (!stored?.token || !stored?.refreshToken) return 'web'
        const apiBase = (import.meta.env.VITE_BASE_URL || '').replace(/\/$/, '')
        if (!apiBase || stored.apiBase?.replace(/\/$/, '') !== apiBase) return
        const localUpdatedAt = Number(localStorage.getItem('captain-token:updatedAt') || 0)
        if (!previousAccess || !previousRefresh || Number(stored.updatedAt) > localUpdatedAt) {
            saveSession('captain', stored, { syncNative: false, updatedAt: stored.updatedAt || Date.now() })
        } else return 'web'
    } catch {
        // APKs antigos não expõem read. Falha da ponte não apaga a sessão web.
    }
}

export async function initializeNativeCaptainSession() {
    const source = await restoreNativeCaptainSession()
    if (source === 'web' && getAccessToken('captain')) await syncNativeCaptainSession()
}

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
            await withHardTimeout(writeSession(() => NativeSession.save({
                token: access,
                refreshToken: refresh || '',
                apiBase,
            })), 5000)
        }
    } catch (err) {
        console.warn('[nativeSession] sync failed:', err?.message || err)
    }
}

export async function clearNativeCaptainSession() {
    if (!isNativePlatform()) return
    try {
        await withHardTimeout(writeSession(() => NativeSession.clear()), 5000)
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
