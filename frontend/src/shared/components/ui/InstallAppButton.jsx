import React from 'react'
import { usePwaInstall } from '@/contexts/PwaInstallContext'
import { useToast } from '@/contexts/ToastContext'

// Botão compacto do header (passageiro/motorista) — ao lado da logo. Usa o mesmo
// deferredPrompt do PwaInstallContext que o banner InstallPrompt.
const InstallAppButton = () => {
    const pwaInstall = usePwaInstall()
    const { addToast } = useToast()

    if (!pwaInstall || pwaInstall.installed) return null

    const handleClick = async () => {
        const result = await pwaInstall.promptInstall()

        if (result === 'accepted') {
            addToast('App instalado! Abra pelo ícone na tela inicial.', 'success')
            return
        }
        if (result === 'ios-guide') {
            addToast(
                'No iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.',
                'info',
                7000
            )
            return
        }
        if (result === 'unavailable') {
            addToast(
                'Instalação ainda não disponível neste navegador. Use o Chrome ou Edge, ou abra pelo menu do navegador.',
                'info',
                6000
            )
            return
        }
        // dismissed / already-installed: silêncio
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            aria-label="Instalar app"
            className="flex items-center gap-1.5 min-h-[36px] px-3 rounded-full bg-brand-500 active:bg-brand-600 text-white text-xs font-semibold shadow-raised flex-shrink-0"
        >
            <i className="ri-download-2-line text-sm" aria-hidden="true" />
            Instalar
        </button>
    )
}

export default InstallAppButton
