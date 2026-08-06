import { registerPlugin } from '@capacitor/core'
import { isNativePlatform } from '@/shared/platform/platform'

const NativeDriverPermissions = registerPlugin('NativeDriverPermissions')

const STORAGE_KEY = 'driverOemPermsSeen_v1'

export function hasSeenOemPermissionsOnboarding() {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

export function markOemPermissionsOnboardingSeen() {
    try {
        localStorage.setItem(STORAGE_KEY, '1')
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

/** Precisa mostrar o card? (nativo + ainda não dispensado + algo pendente ou Xiaomi). */
export async function shouldShowOemPermissionsCard() {
    if (!isNativePlatform()) return false
    if (hasSeenOemPermissionsOnboarding()) return false
    const status = await getDriverPermissionStatus()
    if (!status.canUseFullScreenIntent) return true
    if (!status.ignoringBatteryOptimizations) return true
    if (status.isXiaomiFamily) return true
    return false
}
