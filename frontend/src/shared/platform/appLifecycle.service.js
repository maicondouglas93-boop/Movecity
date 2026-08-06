import { isNativePlatform } from '@/shared/platform/platform'

/**
 * Lifecycle unificado.
 * Web: visibilitychange. Android: @capacitor/app appStateChange + backButton.
 */

export function onAppActive(callback) {
    if (isNativePlatform()) {
        let handle
        import('@capacitor/app').then(({ App }) => {
            handle = App.addListener('appStateChange', ({ isActive }) => {
                if (isActive) callback()
            })
        })
        return () => {
            handle?.then?.((h) => h.remove())
            handle?.remove?.()
        }
    }

    const onVis = () => {
        if (document.visibilityState === 'visible') callback()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
}

/**
 * Botão voltar Android.
 * onBack() deve retornar true se consumiu o evento.
 */
export function onBackButton(onBack) {
    if (!isNativePlatform()) return () => {}

    let handle
    import('@capacitor/app').then(({ App }) => {
        handle = App.addListener('backButton', ({ canGoBack }) => {
            const consumed = onBack({ canGoBack })
            if (!consumed && canGoBack) {
                window.history.back()
            } else if (!consumed) {
                App.minimizeApp?.()
            }
        })
    })

    return () => {
        handle?.then?.((h) => h.remove())
        handle?.remove?.()
    }
}
