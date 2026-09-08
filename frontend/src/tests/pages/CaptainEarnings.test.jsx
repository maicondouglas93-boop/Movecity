import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import CaptainEarnings from '@/driver/pages/CaptainEarnings'
import api from '@/shared/services/axios'
import { validateEarnings } from '@/driver/services/driverEarnings'

vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: vi.fn(() => 'fake-token') }))
const dto = (amount = 10, range = 'day') => ({ range, totalEarnings: amount, totalRides: 1,
    rides: [{ rideId: 'r1', pickup: 'Origem longa, bairro completo', destination: 'Rua de destino', date: '2026-09-08', netEarnings: amount }] })
const section = (title = 'Ganhos de hoje') => within(screen.getByRole('region', { name: title }))
const clients = []
function mount(captain = { _id: 'c1', earnings: 999.99 }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    clients.push(client)
    const tree = owner => <QueryClientProvider client={client}><MemoryRouter>
        <CaptainDataContext.Provider value={{ captain: owner }}><CaptainEarnings /></CaptainDataContext.Provider>
    </MemoryRouter></QueryClientProvider>
    const view = render(tree(captain))
    return { client, changeOwner: owner => view.rerender(tree(owner)) }
}
beforeEach(() => { vi.clearAllMocks(); onlineManager.setOnline(true); api.get.mockResolvedValue({ data: dto() }) })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true) })
async function expandLifetime() {
    const details = screen.getByText('Ganhos acumulados').closest('details')
    details.open = true
    fireEvent(details, new Event('toggle'))
}

describe('Ganhos: período primeiro e indisponibilidade distinta de zero', () => {
    it('mostra somente líquido autorizado pelo DTO; acumulado só carrega ao expandir', async () => {
        api.get.mockImplementation(async url => ({ data: dto(url.includes('all') ? 46.56 : 10, url.includes('all') ? 'all' : 'day') }))
        mount()
        expect(await section().findByText('R$ 10,00')).toBeInTheDocument()
        expect(screen.queryByText('Bruto das corridas')).toBeNull()
        expect(screen.queryByText('Comissão')).toBeNull()
        expect(api.get).toHaveBeenCalledTimes(1)
        expect(screen.queryByText('R$ 999,99')).toBeNull()
        await expandLifetime()
        expect(await screen.findByText('R$ 46,56')).toBeInTheDocument()
        expect(screen.queryByText(/Avaliação|Desempenho/)).toBeNull()
    })
    it('falha inicial não mostra saldo zero nem lista vazia', async () => {
        api.get.mockRejectedValue(new Error('timeout'))
        mount()
        expect(await section().findByText(/não zerado/)).toBeInTheDocument()
        expect(section().getByText('Indisponível')).toBeInTheDocument()
        expect(screen.queryByText('R$ 0,00')).toBeNull()
        expect(screen.queryByText('Nenhuma corrida no período')).toBeNull()
    })
    it('zero confirmado é mostrado como zero', async () => {
        api.get.mockResolvedValue({ data: { ...dto(0), totalRides: 0, rides: [] } })
        mount()
        expect(await screen.findByText('Nenhuma corrida no período')).toBeInTheDocument()
        expect(section().getAllByText('R$ 0,00')).toHaveLength(1)
    })
    it('conserva valor, lista e horário na falha de atualização e recupera pelo botão', async () => {
        mount()
        await section().findByText('R$ 10,00')
        const timestamp = section().getByText(/Última consulta válida/).textContent
        api.get.mockRejectedValueOnce(new Error('falha'))
        fireEvent.click(section().getByRole('button', { name: 'Atualizar período' }))
        expect(await section().findByText(/Exibindo a última consulta válida/)).toBeInTheDocument()
        expect(section().getByText('R$ 10,00')).toBeInTheDocument()
        expect(screen.getByText('Origem longa, bairro completo')).toBeInTheDocument()
        expect(section().getByText(/Última consulta válida/).textContent).toBe(timestamp)
        api.get.mockResolvedValue({ data: dto(20) })
        fireEvent.click(section().getByRole('button', { name: 'Atualizar período' }))
        expect(await section().findByText('R$ 20,00')).toBeInTheDocument()
        expect(screen.queryByText(/Não foi possível atualizar/)).toBeNull()
    })
    it('resposta incompleta não substitui o último valor válido', async () => {
        mount()
        await section().findByText('R$ 10,00')
        api.get.mockResolvedValue({ data: { ...dto(), totalEarnings: null } })
        fireEvent.click(section().getByRole('button', { name: 'Atualizar período' }))
        await section().findByText(/Exibindo a última consulta válida/)
        expect(section().getByText('R$ 10,00')).toBeInTheDocument()
    })
    it('troca de período não usa os ganhos do dia como se fossem da semana', async () => {
        let finish
        mount()
        await section().findByText('R$ 10,00')
        api.get.mockImplementation(() => new Promise(resolve => { finish = resolve }))
        fireEvent.click(screen.getByRole('button', { name: '7 dias' }))
        expect(screen.queryByText('R$ 10,00')).toBeNull()
        expect(screen.getByRole('button', { name: '7 dias' })).toHaveAttribute('aria-pressed', 'true')
        await act(async () => finish({ data: dto(70, 'week') }))
        expect(await section('Ganhos dos últimos 7 dias').findByText('R$ 70,00')).toBeInTheDocument()
    })
    it('resposta tardia de outro período não sobrescreve o selecionado', async () => {
        let finish
        api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
        mount()
        api.get.mockResolvedValue({ data: dto(300, 'month') })
        fireEvent.click(screen.getByRole('button', { name: '30 dias' }))
        await section('Ganhos dos últimos 30 dias').findByText('R$ 300,00')
        await act(async () => finish({ data: dto(10) }))
        expect(screen.queryByText('R$ 10,00')).toBeNull()
    })
    it('troca de conta isola cache e cancela a consulta anterior', async () => {
        let finish
        api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
        const { changeOwner } = mount()
        const signal = api.get.mock.calls[0][1].signal
        api.get.mockResolvedValue({ data: dto(20) })
        changeOwner({ _id: 'c2' })
        await section().findByText('R$ 20,00')
        expect(signal.aborted).toBe(true)
        await act(async () => finish({ data: dto(999) }))
        expect(screen.queryByText('R$ 999,00')).toBeNull()
    })
    it('não consulta sem identificar a conta', () => {
        mount(null)
        expect(screen.getByText(/Aguardando a identificação/)).toBeInTheDocument()
        expect(api.get).not.toHaveBeenCalled()
    })
    it('falha no acumulado tem erro e retry independentes do período', async () => {
        api.get.mockImplementation(async url => {
            if (url.includes('all')) throw new Error('falha acumulado')
            return { data: dto() }
        })
        mount()
        await section().findByText('R$ 10,00')
        await expandLifetime()
        expect(await section('Total líquido acumulado').findByText(/não zerado/)).toBeInTheDocument()
        expect(section().queryByText(/Não foi possível/)).toBeNull()
        api.get.mockResolvedValue({ data: dto(40, 'all') })
        fireEvent.click(section('Total líquido acumulado').getByRole('button', { name: 'Atualizar acumulado' }))
        expect(await section('Total líquido acumulado').findByText('R$ 40,00')).toBeInTheDocument()
        expect(section().getByText('R$ 10,00')).toBeInTheDocument()
    })
    it('sem internet informa a consulta pausada sem inventar zero', async () => {
        onlineManager.setOnline(false)
        mount()
        expect(await screen.findByText(/Sem conexão para consultar/)).toBeInTheDocument()
        expect(section().getByText('Indisponível')).toBeInTheDocument()
        expect(api.get).not.toHaveBeenCalled()
        act(() => onlineManager.setOnline(true))
        await section().findByText('R$ 10,00')
    })
    it('ganho por corrida ausente não vira zero nem confirma recebimento', async () => {
        api.get.mockResolvedValue({ data: { ...dto(), rides: [{ rideId: 'r1' }] } })
        mount()
        await section().findByText('R$ 10,00')
        expect(screen.getByText('Indisponível')).toBeInTheDocument()
        expect(screen.queryByText('R$ 0,00')).toBeNull()
        expect(screen.queryByText('Você recebeu')).toBeNull()
    })
    it.each([null, undefined, '', '10', NaN, Infinity])('rejeita total inválido %s', total => {
        expect(() => validateEarnings({ ...dto(), totalEarnings: total }, 'day')).toThrow()
    })
    it('rejeita um DTO de outro período', () => {
        expect(() => validateEarnings(dto(10, 'week'), 'day')).toThrow()
    })
    it.each([null, { rideId: 'r1', pickup: {} }])('rejeita linha malformada sem derrubar a tela', ride => {
        expect(() => validateEarnings({ ...dto(), rides: [ride] }, 'day')).toThrow()
    })
})
