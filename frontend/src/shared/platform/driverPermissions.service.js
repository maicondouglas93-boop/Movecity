import { registerPlugin } from '@capacitor/core'
import { isNativePlatform } from '@/shared/platform/platform'

const NativeDriverPermissions = registerPlugin('NativeDriverPermissions')

const STORAGE_KEY = 'driverOemPermsSeen_v1'

// Auditoria Android (2026-08-07, M1): antes, "Agora não" (ou "Já configurei") gravava
// um '1' fixo e o card nunca mais reaparecia — um motorista que dispensasse sem
// configurar nada (ex.: Full-Screen Intent) ficava sem aviso pelo resto da vida do
// app. Agora grava o timestamp da dispensa; RECHECK_INTERVAL_MS define depois de
// quanto tempo o card pode voltar a aparecer, e só volta se algo crítico continuar
// pendente (shouldShowOemPermissionsCard já reconfere o status real).
const RECHECK_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000 // 3 dias

export function hasSeenOemPermissionsOnboarding() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return false
        const dismissedAt = Number(raw)
        if (!Number.isFinite(dismissedAt)) return false
        return (Date.now() - dismissedAt) < RECHECK_INTERVAL_MS
    } catch {
        return false
    }
}

export function markOemPermissionsOnboardingSeen() {
    try {
        localStorage.setItem(STORAGE_KEY, String(Date.now()))
    } catch {
        /* ignore */
    }
}

export async function getDriverPermissionStatus() {
    if (!isNativePlatform()) {
        return {
            native: false,
            canUseFullScreenIntent: true,
            ignoringBatteryOptimizations: true,
            hasNotificationPolicyAccess: true,
            isXiaomiFamily: false,
        }
    }
    try {
        const status = await NativeDriverPermissions.getStatus()
        return { native: true, ...status }
    } catch (err) {
        console.warn('[DriverPermissions] getStatus failed:', err?.message || err)
        return {
            native: true,
            canUseFullScreenIntent: true,
            ignoringBatteryOptimizations: true,
            hasNotificationPolicyAccess: true,
            isXiaomiFamily: false,
        }
    }
}

export async function openDriverAppSettings() {
    if (!isNativePlatform()) return
    try {
        await NativeDriverPermissions.openAppSettings()
    } catch (err) {
        console.warn('[DriverPermissions] openAppSettings:', err?.message || err)
    }
}

export async function openFullScreenIntentSettings() {
    if (!isNativePlatform()) return
    try {
        await NativeDriverPermissions.openFullScreenIntentSettings()
    } catch (err) {
        console.warn('[DriverPermissions] openFullScreenIntentSettings:', err?.message || err)
    }
}

/** Auditoria Android (2026-08-07, H3): acesso a Não Perturbe — sem ele, setBypassDnd()
 *  do canal de ofertas não tem efeito nenhum (confirmado no aparelho de teste). */
export async function openNotificationPolicySettings() {
    if (!isNativePlatform()) return
    try {
        await NativeDriverPermissions.openNotificationPolicySettings()
    } catch (err) {
        console.warn('[DriverPermissions] openNotificationPolicySettings:', err?.message || err)
    }
}

export async function openBatteryOptimizationSettings() {
    if (!isNativePlatform()) return
    try {
        await NativeDriverPermissions.openBatteryOptimizationSettings()
    } catch (err) {
        console.warn('[DriverPermissions] openBatteryOptimizationSettings:', err?.message || err)
    }
}

export async function openOemAutostartSettings() {
    if (!isNativePlatform()) return
    try {
        await NativeDriverPermissions.openOemAutostartSettings()
    } catch (err) {
        console.warn('[DriverPermissions] openOemAutostartSettings:', err?.message || err)
    }
}

export async function openOemOtherPermissions() {
    if (!isNativePlatform()) return
    try {
        await NativeDriverPermissions.openOemOtherPermissions()
    } catch (err) {
        console.warn('[DriverPermissions] openOemOtherPermissions:', err?.message || err)
    }
}

/** Android 10+: pede ACCESS_BACKGROUND_LOCATION (após foreground). */
export async function requestBackgroundLocationPermission() {
    if (!isNativePlatform()) return { granted: true, state: 'web' }
    try {
        const result = await NativeDriverPermissions.requestBackgroundLocation()
        return {
            granted: Boolean(result?.granted),
            state: result?.state || (result?.granted ? 'granted' : 'denied'),
        }
    } catch (err) {
        console.warn('[DriverPermissions] requestBackgroundLocation:', err?.message || err)
        return { granted: false, state: 'error', message: err?.message }
    }
}

/** Precisa mostrar o card? (nativo + ainda não dispensado + algo pendente ou Xiaomi). */
export async function shouldShowOemPermissionsCard() {
    if (!isNativePlatform()) return false
    if (hasSeenOemPermissionsOnboarding()) return false
    const status = await getDriverPermissionStatus()
    if (!status.canUseFullScreenIntent) return true
    if (!status.ignoringBatteryOptimizations) return true
    if (status.hasNotificationPolicyAccess === false) return true
    if (status.hasBackgroundLocation === false) return true
    if (status.isXiaomiFamily) return true
    return false
}
