import React, { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// Auditoria PWA (2026-08-03, A1): antes, cada deploy substituía o Service Worker das
// abas abertas em segundo plano (skipWaiting+clientsClaim do modo autoUpdate),
// silenciosamente — o JavaScript já carregado na memória do usuário continuava sendo o
// antigo até ele fechar/reabrir o app manualmente, sem nenhum aviso de que existia uma
// versão nova. O botão aqui só recarrega quando a pessoa decide — nunca automático,
// pra não interromper uma corrida em andamento.
//
// Checagem periódica (2026-08-04): o navegador só rechecava o sw.js sozinho em
// navegação/reload da página — um motorista com o app aberto em segundo plano por
// horas podia nunca ver este aviso, mesmo com o deploy já no ar. registration.update()
// é uma checagem barata (respeita cache-control do servidor); repetir a cada 30 min
// pega um deploy dentro do mesmo turno, e a volta do background é justamente o
// momento mais provável de ter perdido um.
const CHECK_INTERVAL_MS = 30 * 60 * 1000

const UpdatePrompt = () => {
    const registrationRef = useRef(null)

    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(_swUrl, registration) {
            registrationRef.current = registration
        },
        onRegisterError(error) {
            console.error('Falha ao registrar o Service Worker:', error)
        },
    })

    useEffect(() => {
        const checkForUpdate = () => registrationRef.current?.update()

        const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS)

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') checkForUpdate()
        }
        document.addEventListener('visibilitychange', handleVisibility)

        return () => {
            clearInterval(interval)
            document.removeEventListener('visibilitychange', handleVisibility)
        }
    }, [])

    if (!needRefresh) return null

    return (
        <div
            role="status"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-overlay w-[calc(100%-2rem)] max-w-sm bg-ink-900 text-white rounded-panel shadow-2xl p-4 flex items-center gap-3"
        >
            <i className="ri-refresh-line text-xl text-brand-500 flex-shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Nova versão disponível</p>
                <p className="text-xs text-white/70 mt-0.5">Atualize para receber as últimas melhorias.</p>
            </div>
            <button
                type="button"
                onClick={() => updateServiceWorker(true)}
                className="min-h-[36px] px-4 rounded-full bg-brand-500 active:bg-brand-600 text-white text-sm font-semibold flex-shrink-0"
            >
                Atualizar
            </button>
        </div>
    )
}

export default UpdatePrompt
