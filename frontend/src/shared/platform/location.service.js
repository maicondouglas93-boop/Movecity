import { Capacitor } from '@capacitor/core'
import { isNativePlatform } from '@/shared/platform/platform'

const FGS_ID = 11001
const FGS_CHANNEL = 'movecity_location'
const isDev = Boolean(import.meta.env.DEV)

let nativeWatchId = null
let webWatchId = null
let fgsActive = false
let fgsTitle = null
let fgsBody = null

function log(...args) {
    if (isDev) console.log('[Location]', ...args)
}

function logFgs(...args) {
    if (isDev) console.log('[ForegroundService]', ...args)
}

function toBrowserLikePosition(coords) {
    return {
        coords: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy ?? null,
            heading: coords.heading ?? null,
            speed: coords.speed ?? null,
            altitude: coords.altitude ?? null,
        },
        timestamp: coords.timestamp || Date.now(),
    }
}

/**
 * Watch de localização unificado (Web Geolocation API ou @capacitor/geolocation).
 * Retorna um handle opaco para clearWatch.
 */
export async function watchPosition(onSuccess, onError, options = {}) {
    const opts = {
        enableHighAccuracy: options.enableHighAccuracy !== false,
        maximumAge: options.maximumAge ?? 3000,
        timeout: options.timeout ?? 10000,
    }

    if (isNativePlatform()) {
        const { Geolocation } = await import('@capacitor/geolocation')
        try {
            const perm = await Geolocation.checkPermissions()
            if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
                const requested = await Geolocation.requestPermissions()
                if (requested.location !== 'granted' && requested.coarseLocation !== 'granted') {
                    log('permission denied')
                    onError?.({ code: 1, message: 'Permissão de localização negada.', PERMISSION_DENIED: 1 })
                    return 'native:denied'
                }
            }
            log('permission granted')
        } catch (err) {
            onError?.({ code: 2, message: err?.message || 'GPS indisponível', POSITION_UNAVAILABLE: 2 })
            return 'native:error'
        }

        nativeWatchId = await Geolocation.watchPosition(opts, (position, err) => {
            if (err) {
                onError?.({ code: 2, message: err.message || 'GPS error', POSITION_UNAVAILABLE: 2 })
                return
            }
            if (position?.coords) {
                log('update received')
                onSuccess(toBrowserLikePosition(position.coords))
            }
        })
        return `native:${nativeWatchId}`
    }

    if (!navigator.geolocation) {
        onError?.({ code: 2, message: 'Geolocalização não suportada', POSITION_UNAVAILABLE: 2 })
        return 'web:unsupported'
    }

    webWatchId = navigator.geolocation.watchPosition(onSuccess, onError, opts)
    return `web:${webWatchId}`
}

export async function clearWatch(handle) {
    if (!handle) return
    if (String(handle).startsWith('native:')) {
        if (nativeWatchId != null) {
            try {
                const { Geolocation } = await import('@capacitor/geolocation')
                await Geolocation.clearWatch({ id: nativeWatchId })
            } catch {
                /* ignore */
            }
            nativeWatchId = null
        }
        return
    }
    if (webWatchId != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(webWatchId)
        webWatchId = null
    }
}

/** Estado de permissão de localização (foreground). */
export async function checkLocationPermission() {
    if (!isNativePlatform()) {
        if (!navigator.geolocation) return { granted: false, state: 'unsupported' }
        if (typeof navigator.permissions?.query === 'function') {
            try {
                const r = await navigator.permissions.query({ name: 'geolocation' })
                return { granted: r.state === 'granted', state: r.state }
            } catch {
                /* fallthrough */
            }
        }
        return { granted: true, state: 'unknown' }
    }
    try {
        const { Geolocation } = await import('@capacitor/geolocation')
        const perm = await Geolocation.checkPermissions()
        const granted = perm.location === 'granted' || perm.coarseLocation === 'granted'
        return { granted, state: perm.location || perm.coarseLocation || 'prompt' }
    } catch {
        return { granted: false, state: 'error' }
    }
}

/** Solicita permissão de localização em primeiro plano. */
export async function requestLocationPermission() {
    if (!isNativePlatform()) {
        return checkLocationPermission()
    }
    try {
        const { Geolocation } = await import('@capacitor/geolocation')
        const requested = await Geolocation.requestPermissions()
        const granted = requested.location === 'granted' || requested.coarseLocation === 'granted'
        log(granted ? 'permission granted' : 'permission denied')
        return { granted, state: requested.location || requested.coarseLocation || 'denied' }
    } catch (err) {
        log('permission error', err?.message)
        return { granted: false, state: 'error', message: err?.message }
    }
}

/**
 * Passo 2 (Android 10+): “Permitir o tempo todo”.
 * Só chama depois do foreground granted — requisito da plataforma.
 */
export async function requestBackgroundLocationPermission() {
    if (!isNativePlatform()) return { granted: true, state: 'web' }
    try {
        const { requestBackgroundLocationPermission: requestBg } = await import(
            '@/shared/platform/driverPermissions.service'
        )
        const result = await requestBg()
        log('background permission', result?.state || result?.granted)
        return result
    } catch (err) {
        log('background permission error', err?.message)
        return { granted: false, state: 'error', message: err?.message }
    }
}

/** Abre detalhes do app no Android (usuário pode ativar “Permitir o tempo todo”). */
export async function openAppSettings() {
    if (!isNativePlatform()) return { opened: false }
    try {
        const { openDriverAppSettings } = await import('@/shared/platform/driverPermissions.service')
        await openDriverAppSettings()
        return { opened: true }
    } catch (err) {
        console.warn('[Location] openAppSettings failed:', err?.message || err)
        try {
            if (Capacitor.getPlatform() === 'android') {
                window.open(
                    'intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:br.com.movecity.driver;end',
                    '_system'
                )
                return { opened: true }
            }
        } catch {
            /* ignore */
        }
    }
    return { opened: false }
}

function fgsPayload(title, body) {
    return {
        id: FGS_ID,
        title,
        body,
        smallIcon: 'ic_stat_movecity',
        notificationChannelId: FGS_CHANNEL,
        silent: true,
        serviceType: 8, // ServiceType.Location
    }
}

/**
 * Foreground Service Android — só nativo.
 * Justificativa: @capacitor/geolocation sozinho é suspenso em background/lock;
 * FGS com notificação persistente é o mecanismo Android suportado para tracking contínuo.
 */
export async function startForegroundTracking({
    title = 'MoveCity Motorista',
    body = 'Sua localização está ativa para serviços.',
} = {}) {
    if (!isNativePlatform()) return { started: false, reason: 'web' }

    try {
        const { ForegroundService, Importance } = await import(
            '@capawesome-team/capacitor-android-foreground-service'
        )
        await ForegroundService.createNotificationChannel({
            id: FGS_CHANNEL,
            name: 'Localização MoveCity',
            description: 'Rastreamento enquanto online ou em serviço',
            importance: Importance?.Default ?? 3,
        }).catch(() => {})

        const perm = await ForegroundService.checkPermissions().catch(() => null)
        if (perm && perm.display !== 'granted') {
            await ForegroundService.requestPermissions().catch(() => {})
        }

        const payload = fgsPayload(title, body)

        if (fgsActive) {
            if (fgsTitle === title && fgsBody === body) {
                return { started: true, reason: 'already' }
            }
            await ForegroundService.updateForegroundService(payload)
            fgsTitle = title
            fgsBody = body
            logFgs('updated', title)
            return { started: true, reason: 'updated' }
        }

        await ForegroundService.startForegroundService(payload)
        fgsActive = true
        fgsTitle = title
        fgsBody = body
        logFgs('started', title)
        return { started: true }
    } catch (err) {
        console.warn('[ForegroundService] start failed:', err?.message || err)
        return { started: false, reason: err?.message || 'fgs_failed' }
    }
}

export async function stopForegroundTracking() {
    if (!isNativePlatform() || !fgsActive) {
        fgsActive = false
        fgsTitle = null
        fgsBody = null
        return { stopped: true }
    }
    try {
        const { ForegroundService } = await import('@capawesome-team/capacitor-android-foreground-service')
        await ForegroundService.stopForegroundService()
        logFgs('stopped')
    } catch (err) {
        console.warn('[ForegroundService] stop failed:', err?.message || err)
    } finally {
        fgsActive = false
        fgsTitle = null
        fgsBody = null
    }
    return { stopped: true }
}

export function isForegroundTrackingActive() {
    return fgsActive
}

/**
 * serviceKind: 'online' | 'ride' | 'parcel' | 'presential'
 * Regra: online OU serviço ativo → FGS; senão → stop.
 * GO/presential só entra quando a corrida presencial já está ativa (hasActiveTrip).
 */
export function resolveTrackingCopy({ isOnline, hasActiveTrip, serviceKind }) {
    if (hasActiveTrip) {
        if (serviceKind === 'parcel') {
            return {
                title: 'MoveCity Motorista',
                body: 'Encomenda em andamento. Localização ativa.',
            }
        }
        if (serviceKind === 'presential') {
            return {
                title: 'MoveCity Motorista',
                body: 'Corrida presencial em andamento. Localização ativa.',
            }
        }
        return {
            title: 'MoveCity Motorista',
            body: 'Corrida em andamento. Localização ativa.',
        }
    }
    if (isOnline) {
        return {
            title: 'MoveCity Motorista',
            body: 'Você está online. Sua localização está ativa para serviços.',
        }
    }
    return null
}

export async function syncTrackingLifecycle({ isOnline, hasActiveTrip, serviceKind = 'ride' }) {
    const need = Boolean(isOnline || hasActiveTrip)
    if (!need) {
        if (isDev) console.log('[DriverStatus]', isOnline ? 'ONLINE' : 'OFFLINE', '→ FGS stop')
        return stopForegroundTracking()
    }
    const copy = resolveTrackingCopy({ isOnline, hasActiveTrip, serviceKind })
    if (isDev) {
        console.log('[DriverStatus]', isOnline ? 'ONLINE' : 'OFFLINE', 'service=', serviceKind || 'none')
    }
    return startForegroundTracking(copy)
}
