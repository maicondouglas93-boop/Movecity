import React, { useEffect, useState } from 'react'

const DISMISSED_KEY = 'installPromptDismissed'

const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

// Auditoria PWA (2026-08-03, M7): sem CTA própria, o app dependia inteiramente da UI
// nativa do navegador pra instalar (ícone discreto na barra de endereço) — Uber/99/
// iFood mostram um convite próprio, contextual, que converte muito mais. Só existe em
// Chrome/Edge Android/desktop — Safari (iOS) nunca dispara 'beforeinstallprompt', então
// lá este componente simplesmente nunca aparece (limitação de plataforma, não bug).
const InstallPrompt = () => {
    const [deferredEvent, setDeferredEvent] = useState(null)
    const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(DISMISSED_KEY))

    useEffect(() => {
        if (isStandalone()) return

        const handleBeforeInstallPrompt = (event) => {
            event.preventDefault()
            setDeferredEvent(event)
        }
        const handleAppInstalled = () => {
            setDeferredEvent(null)
        }

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
        window.addEventListener('appinstalled', handleAppInstalled)
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
            window.removeEventListener('appinstalled', handleAppInstalled)
        }
    }, [])

    const handleInstall = async () => {
        if (!deferredEvent) return
        deferredEvent.prompt()
        await deferredEvent.userChoice
        setDeferredEvent(null)
    }

    const handleDismiss = () => {
        localStorage.setItem(DISMISSED_KEY, '1')
        setDismissed(true)
    }

    if (!deferredEvent || dismissed) return null

    return (
        <div
            role="status"
            // bottom-24 (não bottom-4): dá espaço pro UpdatePrompt não empilhar por cima
            // nos raros casos em que os dois aparecem ao mesmo tempo.
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-overlay w-[calc(100%-2rem)] max-w-sm bg-white text-ink-900 rounded-panel shadow-2xl p-4 flex items-center gap-3 border border-line"
        >
            <i className="ri-install-line text-xl text-brand-500 flex-shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Instalar o MoveCity</p>
                <p className="text-xs text-ink-400 mt-0.5">Acesso rápido e notificações mesmo com o app fechado.</p>
            </div>
            <div className="flex flex-col gap-1 flex-shrink-0">
                <button
                    type="button"
                    onClick={handleInstall}
                    className="min-h-[36px] px-4 rounded-full bg-brand-500 active:bg-brand-600 text-white text-sm font-semibold"
                >
                    Instalar
                </button>
                <button
                    type="button"
                    onClick={handleDismiss}
                    className="text-xs text-ink-400 font-medium"
                >
                    Agora não
                </button>
            </div>
        </div>
    )
}

export default InstallPrompt
