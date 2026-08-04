import React, { useState } from 'react'
import { usePwaInstall } from '@/contexts/PwaInstallContext'

const DISMISSED_KEY = 'installPromptDismissed'

// Banner flutuante de instalação. O deferredPrompt vive em PwaInstallContext —
// compartilhado com o botão "Instalar" dos headers.
const InstallPrompt = () => {
    const pwaInstall = usePwaInstall()
    const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(DISMISSED_KEY))

    if (!pwaInstall || pwaInstall.installed || !pwaInstall.canInstall || dismissed) return null

    const handleInstall = async () => {
        await pwaInstall.promptInstall()
    }

    const handleDismiss = () => {
        localStorage.setItem(DISMISSED_KEY, '1')
        setDismissed(true)
    }

    return (
        <div
            role="status"
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
