import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// Fonte única do estado de atualização do Service Worker (2026-08-04). Antes só
// UpdatePrompt.jsx chamava useRegisterSW — quando o botão manual "Atualizar app" foi
// pedido pros menus do passageiro e do motorista, esses dois componentes passaram a
// precisar do mesmo estado (needRefresh/updateServiceWorker) sem duplicar o registro
// do worker.
export const PwaUpdateContext = createContext(null)

// Ver UpdatePrompt.jsx (2026-08-04): o navegador só rechecava o sw.js sozinho em
// navegação/reload — sem isto, quem ficasse com o app aberto em segundo plano por
// horas podia nunca ver o aviso de nova versão.
const CHECK_INTERVAL_MS = 30 * 60 * 1000

// Baixar o precache novo pode demorar em 4G; 5s fazia o botão desistir cedo demais e
// mentir "já está atualizado" enquanto o SW ainda instalava.
const MANUAL_CHECK_TIMEOUT_MS = 15000

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
            const pending = pendingResolveRef.current
            pendingResolveRef.current = null
            if (typeof pending === 'function') pending(true)
        },
        onRegisterError(error) {
            console.error('Falha ao registrar o Service Worker:', error)
        },
    })

    // checkForUpdate: força registration.update() e devolve true se houver SW novo
    // esperando (waiting) ou se onNeedRefresh disparar.
    //
    // Bug (2026-08-04): com registerType 'autoUpdate', onNeedRefresh NUNCA rodava —
    // o botão "Atualizar app" sempre caía no timeout e mostrava "já atualizado",
    // enquanto o JS antigo seguia em memória até limpar o cache. Agora o vite usa
    // 'prompt' e esta função também observa updatefound/waiting diretamente.
    const checkForUpdate = useCallback(() => {
        return new Promise((resolve) => {
            const registration = registrationRef.current
            if (!registration) {
                resolve(false)
                return
            }

            if (registration.waiting) {
                resolve(true)
                return
            }

            let settled = false
            const finish = (value) => {
                if (settled) return
                settled = true
                if (pendingResolveRef.current === finishTrue) {
                    pendingResolveRef.current = null
                }
                registration.removeEventListener('updatefound', onUpdateFound)
                clearTimeout(timer)
                resolve(value)
            }

            const finishTrue = () => finish(true)
            pendingResolveRef.current = finishTrue

            const onUpdateFound = () => {
                const installing = registration.installing
                if (!installing) return
                installing.addEventListener('statechange', () => {
                    // 'installed' + controller já existente = update (não 1ª instalação).
                    if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                        finish(true)
                    }
                })
            }

            registration.addEventListener('updatefound', onUpdateFound)

            const timer = setTimeout(() => {
                if (registration.waiting) finish(true)
                else finish(false)
            }, MANUAL_CHECK_TIMEOUT_MS)

            registration.update()
                .then(() => {
                    if (registration.waiting) finish(true)
                })
                .catch(() => finish(false))
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
