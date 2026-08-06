import api from '@/shared/services/axios'
import { isNativePlatform, getPlatformLabel } from '@/shared/platform/platform'
import {
    requestFCMToken as requestWebFcmToken,
    getCurrentFcmToken as getCurrentWebFcmToken,
    onForegroundMessage as onWebForegroundMessage,
} from '@/shared/services/fcm'

let nativeToken = null
let deepLinkHandler = null

/**
 * Push nativo exige google-services.json + plugin google-services no Android.
 * Sem isso, PushNotifications.register() lança FATAL no thread nativo e o SO
 * mata o app (não dá pra capturar com try/catch JS).
 *
 * Default: LIGADO (release/driver). Desative só com VITE_NATIVE_PUSH_ENABLED=false
 * em .env.driver.local quando estiver sem google-services.json.
 */
function isNativePushConfigured() {
    const raw = String(import.meta.env.VITE_NATIVE_PUSH_ENABLED ?? 'true').toLowerCase()
    return raw !== 'false' && raw !== '0' && raw !== 'off'
}

/**
 * Registra push token no backend existente POST /notifications/token.
 * Schema atual: { token, device } — device='android' no nativo; UA na web.
 * Não cria segundo endpoint (auditoria: device já distingue plataforma).
 */
async function registerTokenWithBackend(pushToken) {
    if (!pushToken) return null
    const device = isNativePlatform() ? 'android' : (navigator.userAgent || 'web')
    await api.post('/notifications/token', {
        token: pushToken,
        device,
    })
    return pushToken
}

export async function registerPush() {
    if (isNativePlatform()) {
        if (!isNativePushConfigured()) {
            console.warn(
                '[push] nativo desativado: falta google-services.json / VITE_NATIVE_PUSH_ENABLED=true'
            )
            return null
        }

        const { PushNotifications } = await import('@capacitor/push-notifications')
        let perm = await PushNotifications.checkPermissions()
        if (perm.receive !== 'granted') {
            perm = await PushNotifications.requestPermissions()
        }
        if (perm.receive !== 'granted') {
            console.warn('[push] permissão negada')
            return null
        }

        return new Promise((resolve) => {
            const finish = (value) => resolve(value)

            PushNotifications.addListener('registration', async (ev) => {
                nativeToken = ev.value
                try {
                    await registerTokenWithBackend(nativeToken)
                } catch (err) {
                    console.warn('[push] falha ao registrar token no backend:', err?.message)
                }
                finish(nativeToken)
            })
            PushNotifications.addListener('registrationError', (err) => {
                console.warn('[push] registrationError', err)
                finish(null)
            })

            PushNotifications.register().catch((err) => {
                console.warn('[push] register() falhou:', err?.message || err)
                finish(null)
            })

            setTimeout(() => finish(nativeToken), 8000)
        })
    }

    return requestWebFcmToken()
}

export async function unregisterPush() {
    try {
        let token = null
        if (isNativePlatform()) {
            token = nativeToken
        } else {
            token = await getCurrentWebFcmToken()
        }
        if (token) {
            await api.delete('/notifications/token', { data: { token } })
        }
    } catch (err) {
        console.warn('[push] unregister:', err?.message || err)
    } finally {
        nativeToken = null
    }
}

/**
 * Listener de notificação em foreground + tap (deep link).
 * handler({ deepLink, data })
 */
export async function bindPushNavigation(handler) {
    deepLinkHandler = handler

    if (isNativePlatform()) {
        // Sem Firebase nativo, não toca no plugin (addListener/register podem
        // inicializar FCM e derrubar o processo).
        if (!isNativePushConfigured()) {
            return () => {
                deepLinkHandler = null
            }
        }

        const { PushNotifications } = await import('@capacitor/push-notifications')
        await PushNotifications.removeAllListeners()

        PushNotifications.addListener('registration', async (ev) => {
            nativeToken = ev.value
            try {
                await registerTokenWithBackend(nativeToken)
            } catch {
                /* ignore */
            }
        })

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            const data = notification?.data || {}
            deepLinkHandler?.({ data, foreground: true })
        })

        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            const data = action?.notification?.data || {}
            const deepLink = data.deepLink || data.link || null
            deepLinkHandler?.({ data, deepLink, fromTap: true })
        })
        return () => {
            PushNotifications.removeAllListeners()
            deepLinkHandler = null
        }
    }

    // Web: foreground FCM; taps ficam no SW (já existente)
    const unsub = onWebForegroundMessage((payload) => {
        deepLinkHandler?.({ data: payload?.data || {}, foreground: true, payload })
    })
    return () => {
        unsub?.()
        deepLinkHandler = null
    }
}

export function getPushPlatform() {
    return getPlatformLabel()
}
