import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import CaptainWallet from '@/driver/pages/CaptainWallet'

vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: vi.fn(() => 'token') }))
vi.mock('@/driver/components/CaptainHeader', () => ({ default: () => <div data-testid='captain-header' /> }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }))
vi.mock('@/shared/utils/whatsapp', () => ({ openWhatsApp: vi.fn(() => true) }))

import api from '@/shared/services/axios'
import { openWhatsApp } from '@/shared/utils/whatsapp'

const socket = { on: vi.fn(), off: vi.fn() }

function renderWallet(captain = { fullname: { firstname: 'João' }, canReceiveRides: true }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <SocketContext.Provider value={{ socket }}>
                    <CaptainDataContext.Provider value={{ captain }}>
                        <CaptainWallet />
                    </CaptainDataContext.Provider>
                </SocketContext.Provider>
            </MemoryRouter>
        </QueryClientProvider>,
    )
}

describe('CaptainWallet — modelo de comissão pré-paga', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        api.get.mockImplementation((url) => Promise.resolve({
            data: url.includes('/transactions')
                ? { transactions: [] }
                : { wallet: { creditBalance: 35, pendingBalance: 99 } },
        }))
    })

    it('explica que o passageiro paga direto e não apresenta repasse ou saque', async () => {
        renderWallet()

        expect(await screen.findByText('R$ 35,00')).toBeInTheDocument()
        expect(screen.getByText(/O valor da corrida vai direto para você/i)).toBeInTheDocument()
        expect(screen.getByText(/serve somente para pagar a comissão/i)).toBeInTheDocument()
        expect(screen.queryByText('Repasses Pendentes')).not.toBeInTheDocument()
        expect(screen.queryByText('Solicitar Saque')).not.toBeInTheDocument()
        expect(screen.queryByText('R$ 99,00')).not.toBeInTheDocument()
    })

    it('orienta a recarga assistida e abre o suporte com mensagem identificada', async () => {
        renderWallet()
        await screen.findByText('R$ 35,00')

        fireEvent.click(screen.getByRole('button', { name: /Recarregar com o suporte/i }))
        expect(screen.getByRole('heading', { name: 'Recarregar créditos' })).toBeInTheDocument()
        expect(screen.getByText(/Envie o comprovante/i)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /Falar com o suporte/i }))
        await waitFor(() => expect(openWhatsApp).toHaveBeenCalledWith(
            undefined,
            expect.stringContaining('João'),
        ))
    })
})
