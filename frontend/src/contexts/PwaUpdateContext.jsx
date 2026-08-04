import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// Fonte única do estado de atualização do Service Worker (2026-08-04). Antes só
// UpdatePrompt.jsx chamava useRegisterSW — quando o botão manual "Atualizar app" foi
// pedido pros menus do passageiro e do motorista, esses dois componentes passaram a
// precisar do mesmo estado (needRefresh/updateServiceWorker) sem duplicar o registro
// do worker. useRegisterSW é seguro de chamar mais de uma vez, mas manter uma única
// instância evita registrar o mesmo listener várias vezes à toa.
export const PwaUpdateContext = createContext(null)

// Ver UpdatePrompt.jsx (2026-08-04): o navegador só rechecava o sw.js sozinho em
// navegação/reload — sem isto, quem ficasse com o app aberto em segundo plano por
// horas podia nunca ver o aviso de nova versão.
const CHECK_INTERVAL_MS = 30 * 60 * 1000

// Tempo de espera pelo resultado de um checkForUpdate() manual antes de desistir e
// avisar "já está atualizado" — registration.update() não devolve se encontrou algo
// novo, só dispara onNeedRefresh de forma assíncrona quando encontra.
const MANUAL_CHECK_TIMEOUT_MS = 5000

export const PwaUpdateProvider = ({ children }) => {
    const registrationRef = useRef(null)
    const pendingResolveRef = useRef(null)

    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(_swUrl, registration) {
            registrationRef.current = registration
        },
        onNeedRefresh() {
            // Resolve qualquer checkForUpdate() manual em andamento — é o sinal de que
            // registration.update() encontrou mesmo uma versão nova.
            pendingResolveRef.current?.(true)
            pendingResolveRef.current = null
        },
        onRegisterError(error) {
            console.error('Falha ao registrar o Service Worker:', error)
        },
    })

    // checkForUpdate: pede ao navegador pra reverificar o sw.js agora. Devolve uma
    // Promise<boolean> — true se uma versão nova foi encontrada (needRefresh virou
    // true), false se não (timeout sem novidade). Usado tanto pelo polling automático
    // quanto pelo botão manual "Atualizar app" dos menus.
    const checkForUpdate = useCallback(() => {
        return new Promise((resolve) => {
            pendingResolveRef.current = resolve
            registrationRef.current?.update()
            setTimeout(() => {
                if (pendingResolveRef.current === resolve) {
                    pendingResolveRef.current = null
                    resolve(false)
                }
            }, MANUAL_CHECK_TIMEOUT_MS)
        })
    }, [])

    useEffect(() => {
        const interval = setInterval(() => registrationRef.current?.update(), CHECK_INTERVAL_MS)

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') registrationRef.current?.update()
        }
        document.addEventListener('visibilitychange', handleVisibility)

        return () => {
            clearInterval(interval)
            document.removeEventListener('visibilitychange', handleVisibility)
        }
    }, [])

    return (
        <PwaUpdateContext.Provider value={{ needRefresh, updateServiceWorker, checkForUpdate }}>
            {children}
        </PwaUpdateContext.Provider>
    )
}

export const usePwaUpdate = () => useContext(PwaUpdateContext)
