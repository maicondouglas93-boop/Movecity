// Role/plataforma do frontend — seams para build web vs build motorista (Capacitor).
// Preferir estes helpers a espalhar Capacitor.isNativePlatform() nas telas.

export function getAppRole() {
    const role = import.meta.env.VITE_APP_ROLE
    return role === 'driver' ? 'driver' : 'web'
}

export function isNativePlatform() {
    try {
        return Boolean(window.Capacitor?.isNativePlatform?.())
    } catch {
        return false
    }
}

export function isWeb() {
    return !isNativePlatform()
}

/** PWA (SW, Install/Update prompts) só no app web completo — nunca no build driver/APK. */
export function shouldEnablePwa() {
    return getAppRole() === 'web' && isWeb()
}

export function getPlatformLabel() {
    if (isNativePlatform()) return 'android'
    return 'web'
}
