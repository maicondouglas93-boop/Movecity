import api from '@/shared/services/axios'
import { isNativePlatform, getPlatformLabel } from '@/shared/platform/platform'
import { getNativePushNotifications } from '@/shared/platform/nativePush.plugin'
import {
    requestFCMToken as requestWebFcmToken,
    getCurrentFcmToken as getCurrentWebFcmToken,
    onForegroundMessage as onWebForegroundMessage,
} from '@/shared/services/fcm'

let nativeToken = null
let nativeRegistrationPromise = null
let nativeRegistrationListenersPromise = null
let resolveNativeRegistration = null

const NATIVE_REGISTRATION_TIMEOUT_MS = 8000

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

function normalizePermissionState(receive) {
    if (receive === 'granted') return 'granted'
    if (receive === 'denied') return 'denied'
    return 'prompt'
}

/**
 * Consulta a permissão sem abrir diálogo do sistema.
 * Mantém permissão e registro do token como estados diferentes: o Android pode
 * permitir notificações e o FCM ainda demorar/falhar ao entregar o token.
 */
export async function getPushPermissionStatus() {
    if (isNativePlatform()) {
        if (!isNativePushConfigured()) {
            return { supported: false, granted: false, state: 'unavailable' }
        }
        try {
            const PushNotifications = await getNativePushNotifications()
            const permission = await PushNotifications.checkPermissions()
            const state = normalizePermissionState(permission?.receive)
            return { supported: true, granted: state === 'granted', state }
        } catch (err) {
            console.warn('[push] falha ao consultar permissão:', err?.message || err)
            return { supported: true, granted: false, state: 'error' }
        }
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
        return { supported: false, granted: false, state: 'unsupported' }
    }
    const state = normalizePermissionState(Notification.permission)
    return { supported: true, granted: state === 'granted', state }
}

async function ensureNativeRegistrationListeners(PushNotifications) {
    if (nativeRegistrationListenersPromise) return nativeRegistrationListenersPromise

    nativeRegistrationListenersPromise = Promise.all([
        PushNotifications.addListener('registration', async (ev) => {
            nativeToken = ev?.value || null
            if (nativeToken) {
                try {
                    await registerTokenWithBackend(nativeToken)
                } catch (err) {
                    // O token existe e a permissão está válida. Falha de rede/backend
                    // não deve virar um aviso falso de "permissão negada".
                    console.warn('[push] falha ao registrar token no backend:', err?.message)
                }
            }
            resolveNativeRegistration?.(nativeToken)
        }),
        PushNotifications.addListener('registrationError', (err) => {
            console.warn('[push] registrationError', err)
            resolveNativeRegistration?.(null)
        }),
    ]).catch((err) => {
        nativeRegistrationListenersPromise = null
        throw err
    })

    return nativeRegistrationListenersPromise
}

async function registerNativePush({ requestPermission = true } = {}) {
    if (!isNativePushConfigured()) {
        console.warn(
            '[push] nativo desativado: falta google-services.json / VITE_NATIVE_PUSH_ENABLED=true'
        )
        return null
    }

    const PushNotifications = await getNativePushNotifications()
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted' && requestPermission) {
        perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== 'granted') {
        if (perm.receive === 'denied') console.warn('[push] permissão negada')
        return null
    }

    await ensureNativeRegistrationListeners(PushNotifications)

    // Evita dois register() concorrentes (Home + bridge/lifecycle). Além de
    // duplicar trabalho, isso fazia um fluxo remover o listener do outro.
    if (nativeRegistrationPromise) return nativeRegistrationPromise

    nativeRegistrationPromise = new Promise((resolve) => {
        let settled = false
        const finish = (value) => {
            if (settled) return
            settled = true
            resolveNativeRegistration = null
            resolve(value)
        }

        resolveNativeRegistration = finish
        const timeoutId = setTimeout(() => finish(nativeToken), NATIVE_REGISTRATION_TIMEOUT_MS)

        PushNotifications.register().catch((err) => {
            console.warn('[push] register() falhou:', err?.message || err)
            clearTimeout(timeoutId)
            finish(null)
        })
    }).finally(() => {
        nativeRegistrationPromise = null
    })

    return nativeRegistrationPromise
}

export async function registerPush(options = {}) {
    if (isNativePlatform()) {
        return registerNativePush(options)
    }

    if (options.requestPermission === false) {
        const permission = await getPushPermissionStatus()
        if (!permission.granted) return null
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
    if (isNativePlatform()) {
        // Sem Firebase nativo, não toca no plugin (addListener/register podem
        // inicializar FCM e derrubar o processo).
        if (!isNativePushConfigured()) {
            return () => {}
        }

        const PushNotifications = await getNativePushNotifications()
        // Nunca usar removeAllListeners() aqui. O registro do FCM pode estar em
        // andamento e depende dos listeners permanentes acima.
        const receivedHandle = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
            const data = notification?.data || {}
            handler?.({ data, foreground: true })
        })

        const actionHandle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            const data = action?.notification?.data || {}
            const deepLink = data.deepLink || data.link || null
            handler?.({ data, deepLink, fromTap: true })
        })
        return () => {
            receivedHandle?.remove?.()
            actionHandle?.remove?.()
        }
    }

    // Web: foreground FCM; taps ficam no SW (já existente)
    const unsub = onWebForegroundMessage((payload) => {
        handler?.({ data: payload?.data || {}, foreground: true, payload })
    })
    return () => {
        unsub?.()
    }
}

export function getPushPlatform() {
    return getPlatformLabel()
}
