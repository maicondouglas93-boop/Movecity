import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import CaptainScheduled from '@/driver/pages/CaptainScheduled'
import { validateUpcoming } from '@/driver/services/driverScheduled'
import api from '@/shared/services/axios'

vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn() } }))
const item = { _id: 's1', kind: 'parcel', scheduledAt: '2026-09-09T14:00:00Z', driverAmount: 17.20,
    fare: 90, vehicleType: 'van', pickup: 'Rua da coleta, 100, bairro completo', destination: 'Rua do destino, 200' }
let client
function mount(id = 'c1') {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const tree = owner => <QueryClientProvider client={client}><MemoryRouter><CaptainDataContext.Provider value={{ captain: owner ? { _id: owner } : null }}>
        <CaptainScheduled /></CaptainDataContext.Provider></MemoryRouter></QueryClientProvider>
    const view = render(tree(id))
    return { ...view, owner: id => view.rerender(tree(id)) }
}
beforeEach(() => { vi.clearAllMocks(); onlineManager.setOnline(true); api.get.mockResolvedValue({ data: { upcoming: [item] } }) })
afterEach(() => { cleanup(); client?.clear(); onlineManager.setOnline(true); vi.useRealTimers() })
describe('Agendados informativos e isolados por conta', () => {
    it('mostra ganho autorizado e endereço sem truncar; não oferece aceite nem inventa veículo', async () => {
        mount()
        expect(await screen.findByText('R$ 17,20')).toBeInTheDocument()
        expect(screen.queryByText('R$ 90,00')).toBeNull()
        expect(screen.getByRole('heading', { name: 'Encomenda · van' })).toBeInTheDocument()
        expect(screen.getByText(/Retirada: Rua da coleta, 100, bairro completo/)).not.toHaveClass('truncate')
        expect(screen.getByText(/Não é uma reserva/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /aceitar/i })).toBeNull()
        expect(api.get.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    })
    it('falha inicial não vira lista vazia; botão recupera', async () => {
        api.get.mockRejectedValueOnce(new Error('network'))
        mount()
        expect(await screen.findByText('Não foi possível consultar os agendados.')).toBeInTheDocument()
        expect(screen.queryByText('Nada agendado por perto')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Atualizar agendados' }))
        expect(await screen.findByText('R$ 17,20')).toBeInTheDocument()
    })
    it('mantém última consulta válida e horário após falha de atualização', async () => {
        mount(); await screen.findByText('R$ 17,20')
        const timestamp = screen.getByText(/Última consulta válida/).textContent
        api.get.mockRejectedValue(new Error('network'))
        fireEvent.click(screen.getByRole('button', { name: 'Atualizar agendados' }))
        expect(await screen.findByText(/Exibindo a última consulta válida/)).toBeInTheDocument()
        expect(screen.getByText('R$ 17,20')).toBeInTheDocument()
        expect(screen.getByText(/Última consulta válida/)).toHaveTextContent(timestamp)
    })
    it('somente array vazio válido mostra ausência', async () => {
        api.get.mockResolvedValue({ data: { upcoming: [] } }); mount()
        expect(await screen.findByText('Nada agendado por perto')).toBeInTheDocument()
    })
    it('ausência de valor e data inválida não viram zero ou Invalid Date', async () => {
        api.get.mockResolvedValue({ data: { upcoming: [{ ...item, driverAmount: null, scheduledAt: 'bad' }] } }); mount()
        expect(await screen.findByText('Indisponível')).toBeInTheDocument()
        expect(screen.getByText('Horário não informado')).toBeInTheDocument()
        expect(screen.queryByText('R$ 0,00')).toBeNull()
    })
    it('isola cache e ignora resposta da conta anterior', async () => {
        let resolve
        api.get.mockReturnValueOnce(new Promise(r => { resolve = r }))
        const view = mount()
        api.get.mockResolvedValue({ data: { upcoming: [] } })
        view.owner('c2')
        await screen.findByText('Nada agendado por perto')
        await act(async () => resolve({ data: { upcoming: [item] } }))
        expect(screen.queryByText('R$ 17,20')).toBeNull()
    })
    it('sem identificação da conta não consulta; offline informa indisponibilidade', async () => {
        const view = mount(null)
        expect(api.get).not.toHaveBeenCalled()
        onlineManager.setOnline(false)
        view.owner('c1')
        expect(await screen.findByText(/Sem conexão para consultar/)).toBeInTheDocument()
        expect(api.get).not.toHaveBeenCalled()
    })
    it('transportes pendurados liberam o botão em 12 segundos', async () => {
        vi.useFakeTimers(); api.get.mockReturnValue(new Promise(() => {})); mount()
        await act(async () => vi.advanceTimersByTimeAsync(12001)); vi.useRealTimers()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar agendados' })).toBeEnabled())
        expect(screen.getByText('Não foi possível consultar os agendados.')).toBeInTheDocument()
    })
    it.each([{}, { upcoming: null }, { upcoming: [null] }, { upcoming: [{ ...item, kind: 'unknown' }] }, { upcoming: [item, item] }])('rejeita DTO inválido %j', data => {
        expect(() => validateUpcoming(data)).toThrow('INVALID_UPCOMING')
    })
})
