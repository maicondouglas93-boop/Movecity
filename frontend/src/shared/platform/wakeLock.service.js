/**
 * Mantém a tela ativa via Screen Wake Lock API (Web e WebView Capacitor quando suportado).
 * No Android, o tracking em background depende do Foreground Service (location.service),
 * não deste wake lock — aqui só evitamos apagar a tela com o app em primeiro plano.
 * Sem plugin extra (regra: não instalar plugin sem necessidade).
 */

let webWakeLock = null
let webReleaseHandler = null

export async function requestWakeLock() {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    try {
        if (webWakeLock) return
        webWakeLock = await navigator.wakeLock.request('screen')
        webReleaseHandler = () => {
            webWakeLock = null
            webReleaseHandler = null
        }
        webWakeLock.addEventListener('release', webReleaseHandler)
    } catch (err) {
        console.warn('[wakeLock]:', err?.message || err)
    }
}

export async function releaseWakeLock() {
    if (!webWakeLock) return
    try {
        if (webReleaseHandler) {
            webWakeLock.removeEventListener('release', webReleaseHandler)
            webReleaseHandler = null
        }
        await webWakeLock.release()
    } catch {
        /* ignore */
    } finally {
        webWakeLock = null
    }
}
