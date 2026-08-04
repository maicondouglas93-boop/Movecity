import React from 'react'
import { usePwaUpdate } from '@/contexts/PwaUpdateContext'

// Auditoria PWA (2026-08-03, A1): antes, cada deploy substituía o Service Worker das
// abas abertas em segundo plano (skipWaiting+clientsClaim do modo autoUpdate),
// silenciosamente — o JavaScript já carregado na memória do usuário continuava sendo o
// antigo até ele fechar/reabrir o app manualmente, sem nenhum aviso de que existia uma
// versão nova. O botão aqui só recarrega quando a pessoa decide — nunca automático,
// pra não interromper uma corrida em andamento.
//
// O registro do Service Worker (useRegisterSW), a checagem periódica e o
// checkForUpdate() manual (usado pelo botão "Atualizar app" dos menus) vivem em
// PwaUpdateContext — este componente só renderiza o aviso quando needRefresh vira true.
const UpdatePrompt = () => {
    const { needRefresh, updateServiceWorker } = usePwaUpdate()

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
