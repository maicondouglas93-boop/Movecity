import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import CaptainWallet from '@/driver/pages/CaptainWallet'

vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: vi.fn(() => 'token') }))
vi.mock('@/driver/components/CaptainHeader', () => ({ default: () => <div data-testid='captain-header' /> }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }))

import api from '@/shared/services/axios'
import { SUPPORT_PHONE } from '@/shared/utils/supportContacts'

const socket = { on: vi.fn(), off: vi.fn() }

const clients = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllEnvs() })
function renderWallet(captain = { _id: 'c1', fullname: { firstname: 'João' }, canReceiveRides: true }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30000 } } })
    clients.push(queryClient)
    const tree = owner => (
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <SocketContext.Provider value={{ socket }}>
                    <CaptainDataContext.Provider value={{ captain: owner }}>
                        <CaptainWallet />
                    </CaptainDataContext.Provider>
                </SocketContext.Provider>
            </MemoryRouter>
        </QueryClientProvider>
    )
    const view = render(tree(captain))
    return { ...view, queryClient, switchAccount: owner => view.rerender(tree(owner)) }
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

        const contact = screen.getByRole('link', { name: 'Falar com o suporte' })
        expect(contact.href).toContain(`wa.me/${SUPPORT_PHONE}`)
        expect(new URL(contact.href).searchParams.get('text')).toContain('João')
        expect(screen.getByRole('link', { name: 'Outras opções de suporte' })).toHaveAttribute('href', '/captain/support?category=payment')
    })

    it('trocar de motorista não mostra saldo ou transações da conta anterior', async () => {
        const previousTransactions = [{ _id: 'tx-c1', type: 'recharge', amount: 35, balanceBefore: 0, balanceAfter: 35, description: 'Recarga da primeira conta', createdAt: '2026-09-12T12:00:00Z' }]
        api.get.mockImplementation(url => Promise.resolve({ data: url.includes('/transactions')
            ? { transactions: previousTransactions }
            : { wallet: { creditBalance: 35 } } }))
        const view = renderWallet()
        await screen.findByText('R$ 35,00', { selector: 'h2' })
        await screen.findByText('Recarga da primeira conta')
        let completeWallet, completeTransactions
        api.get.mockImplementation(url => url.includes('/transactions')
            ? new Promise(resolve => { completeTransactions = () => resolve({ data: { transactions: [] } }) })
            : new Promise(resolve => { completeWallet = () => resolve({ data: { wallet: { creditBalance: 80 } } }) }))
        view.switchAccount({ _id: 'c2', fullname: { firstname: 'Ana' } })
        expect(screen.queryByText('R$ 35,00')).not.toBeInTheDocument()
        expect(screen.queryByText('Recarga da primeira conta')).not.toBeInTheDocument()
        await act(async () => { completeWallet() })
        expect(await screen.findByText('R$ 80,00')).toBeInTheDocument()
        expect(screen.queryByText('Recarga da primeira conta')).not.toBeInTheDocument()
        await act(async () => { completeTransactions() })
        expect(await screen.findByText('Nenhuma transação ainda')).toBeInTheDocument()
        expect(view.queryClient.getQueryData(['captainWallet', 'c1']).creditBalance).toBe(35)
        expect(view.queryClient.getQueryData(['captainWallet', 'c2']).creditBalance).toBe(80)
        expect(view.queryClient.getQueryData(['captainTransactions', 'c1'])).toEqual(previousTransactions)
        expect(view.queryClient.getQueryData(['captainTransactions', 'c2'])).toEqual([])
    })

    it('não consulta carteira sem a identidade do motorista', () => {
        renderWallet(null)
        expect(api.get).not.toHaveBeenCalled()
        expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument()
    })

    it('usa o contato configurado quando disponível', async () => {
        vi.stubEnv('VITE_SUPPORT_WHATSAPP', '5533999991234')
        renderWallet()
        await screen.findByText('R$ 35,00')
        fireEvent.click(screen.getByRole('button', { name: /Recarregar com o suporte/i }))
        expect(screen.getByRole('link', { name: 'Falar com o suporte' }).href).toContain('wa.me/5533999991234')
    })
})
