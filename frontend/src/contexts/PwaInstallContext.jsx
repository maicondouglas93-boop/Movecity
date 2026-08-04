import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

export const PwaInstallContext = createContext(null)

const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true

const isIos = () => {
    const ua = window.navigator.userAgent || ''
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

// Fonte única do beforeinstallprompt (2026-08-04): o evento só pode ser capturado uma
// vez — o banner InstallPrompt e o botão do header precisam compartilhar o mesmo
// deferredPrompt, senão um dos dois fica sem conseguir instalar de verdade.
export const PwaInstallProvider = ({ children }) => {
    const deferredRef = useRef(null)
    const [canInstall, setCanInstall] = useState(false)
    const [installed, setInstalled] = useState(() => (typeof window !== 'undefined' ? isStandalone() : false))

    useEffect(() => {
        if (isStandalone()) {
            setInstalled(true)
            return undefined
        }

        const handleBeforeInstallPrompt = (event) => {
            event.preventDefault()
            deferredRef.current = event
            setCanInstall(true)
        }
        const handleAppInstalled = () => {
            deferredRef.current = null
            setCanInstall(false)
            setInstalled(true)
        }

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
        window.addEventListener('appinstalled', handleAppInstalled)
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
            window.removeEventListener('appinstalled', handleAppInstalled)
        }
    }, [])

    // promptInstall: devolve
    //   'accepted' | 'dismissed' | 'unavailable' | 'ios-guide' | 'already-installed'
    const promptInstall = useCallback(async () => {
        if (isStandalone() || installed) return 'already-installed'

        const deferred = deferredRef.current
        if (deferred) {
            deferred.prompt()
            const choice = await deferred.userChoice
            deferredRef.current = null
            setCanInstall(false)
            if (choice?.outcome === 'accepted') {
                setInstalled(true)
                return 'accepted'
            }
            return 'dismissed'
        }

        if (isIos()) return 'ios-guide'
        return 'unavailable'
    }, [installed])

    return (
        <PwaInstallContext.Provider value={{ canInstall, installed, promptInstall, isIos: isIos() }}>
            {children}
        </PwaInstallContext.Provider>
    )
}

export const usePwaInstall = () => useContext(PwaInstallContext)
