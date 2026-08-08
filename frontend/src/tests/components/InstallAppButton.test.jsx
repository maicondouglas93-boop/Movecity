import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import InstallAppButton from '@/shared/components/ui/InstallAppButton'
import { PwaInstallProvider } from '@/shared/contexts/PwaInstallContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'

// Verifica o botão "Instalar" do header do passageiro (Header.jsx) de ponta a ponta:
// beforeinstallprompt real (simulado) → clique → deferred.prompt() → userChoice →
// toast certo pra cada desfecho. Sem isso, PwaInstallContext e InstallAppButton não
// tinham nenhuma cobertura própria (só um mock em Home.test.jsx que desliga o botão).
const renderButton = () => render(
    <ToastProvider>
        <PwaInstallProvider>
            <InstallAppButton />
        </PwaInstallProvider>
    </ToastProvider>
)

const dispatchBeforeInstallPrompt = (userChoiceOutcome) => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = vi.fn().mockResolvedValue(undefined)
    event.userChoice = Promise.resolve({ outcome: userChoiceOutcome })
    window.dispatchEvent(event)
    return event
}

describe('InstallAppButton (header do passageiro)', () => {
    it('aceita a instalação: chama deferred.prompt() e mostra o toast de sucesso', async () => {
        renderButton()
        const event = dispatchBeforeInstallPrompt('accepted')

        fireEvent.click(screen.getByRole('button', { name: /instalar app/i }))

        await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1))
        expect(await screen.findByText(/app instalado/i)).toBeInTheDocument()
    })

    it('usuário recusa o prompt nativo: não mostra toast de sucesso nem de erro', async () => {
        renderButton()
        dispatchBeforeInstallPrompt('dismissed')

        fireEvent.click(screen.getByRole('button', { name: /instalar app/i }))

        await waitFor(() => {
            expect(screen.queryByText(/app instalado/i)).not.toBeInTheDocument()
        })
        expect(screen.queryByText(/instalação ainda não disponível/i)).not.toBeInTheDocument()
    })

    it('sem beforeinstallprompt disponível (navegador não suporta): avisa pra usar Chrome/Edge', async () => {
        renderButton()

        fireEvent.click(screen.getByRole('button', { name: /instalar app/i }))

        expect(await screen.findByText(/instalação ainda não disponível/i)).toBeInTheDocument()
    })

    it('some depois que appinstalled dispara (já instalado)', async () => {
        renderButton()
        dispatchBeforeInstallPrompt('accepted')
        expect(screen.getByRole('button', { name: /instalar app/i })).toBeInTheDocument()

        window.dispatchEvent(new Event('appinstalled'))

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /instalar app/i })).not.toBeInTheDocument()
        })
    })
})
