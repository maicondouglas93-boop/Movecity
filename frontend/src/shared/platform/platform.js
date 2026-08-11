// Role/plataforma do frontend — seams para Web, APK Motorista e APK Passageiro.
// Preferir estes helpers a espalhar Capacitor.isNativePlatform() nas telas.

export function getAppRole() {
    const role = import.meta.env.VITE_APP_ROLE
    if (role === 'driver' || role === 'passenger') return role
    return 'web'
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

/** PWA (SW, Install/Update prompts) só no app web completo — nunca nos APKs. */
export function shouldEnablePwa() {
    return getAppRole() === 'web' && isWeb()
}

export function getPlatformLabel() {
    if (isNativePlatform()) return 'android'
    return 'web'
}
