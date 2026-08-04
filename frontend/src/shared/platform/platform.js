// Role/plataforma do frontend — seams para build web vs build motorista (futuro Capacitor).
// Sem dependência de @capacitor/*: detecção nativa só se o runtime injetar window.Capacitor.

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

/** PWA (SW, Install/Update prompts) só no app web completo — nunca no build driver. */
export function shouldEnablePwa() {
    return getAppRole() === 'web' && isWeb()
}
