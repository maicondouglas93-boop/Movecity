import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/shared/services/db'
import { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import CaptainRidesHistory from '@/driver/pages/CaptainRidesHistory'
import api from '@/shared/services/axios'

const state = vi.hoisted(() => ({ navigate: vi.fn(), toast: vi.fn() }))
vi.mock('react-router-dom', async () => ({ ...await vi.importActual('react-router-dom'), useNavigate: () => state.navigate }))
vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: () => 'token', getSessionOwnerId: () => 'cap1' }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: state.toast }) }))
vi.mock('@/driver/components/CaptainHeader', () => ({ default: () => null }))
const ride = { _id: 'r1', status: 'started', pickup: 'Rua A', destination: null,
    source: 'driver_initiated', fare: 0, createdAt: '2026-09-07T17:54:00Z' }
let client
const syncCaptainRide = vi.fn(async () => undefined)
function mount(captainRide = null) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<MemoryRouter><QueryClientProvider client={client}>
        <SocketContext.Provider value={{ socket: null }}>
            <RideContext.Provider value={{ captainRide, setCaptainRide: vi.fn(), syncCaptainRide }}>
                <CaptainRidesHistory />
            </RideContext.Provider>
        </SocketContext.Provider>
    </QueryClientProvider></MemoryRouter>)
}
async function pending(extra = {}) {
    return db.offlineActions.add({ type: 'end-ride', rideId: 'r1', timestamp: Date.now(), ownerId: 'cap1',
        rideSnapshot: { pickup: 'Rua A', source: 'driver_initiated' }, ...extra })
}

beforeEach(async () => {
    await db.delete(); await db.open()
    vi.clearAllMocks()
    api.get.mockResolvedValue({ data: { activeRide: ride, rides: [], pendingOffers: [] } })
})
afterEach(async () => { cleanup(); client?.clear(); vi.restoreAllMocks(); await db.delete() })

describe('histórico considera a finalização persistida no aparelho', () => {
    it('não reabre o started do servidor nem mostra R$ 0 para finalização pendente', async () => {
        await pending(); mount({ ...ride, status: 'finished' })
        expect(await screen.findByText('Finalização pendente')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /voltar para corrida/i })).toBeNull()
        expect(screen.queryByText('Em andamento')).toBeNull()
        expect(screen.getByText('A confirmar')).toBeInTheDocument()
    })
    it('sobrevive à reabertura sem contexto e sem resposta de rede', async () => {
        await pending(); api.get.mockRejectedValue(new Error('Offline')); mount()
        expect(await screen.findByText('Finalização pendente')).toBeInTheDocument()
        expect(screen.getByText('Rua A')).toBeInTheDocument()
    })
    it('reconhece uma pendência da versão anterior sem ownerId pelo id autorizado na API', async () => {
        await pending({ ownerId: null, rideSnapshot: undefined }); mount()
        expect(await screen.findByText('Finalização pendente')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /voltar para corrida/i })).toBeNull()
    })
    it('não mostra detalhes de pendência de outra conta', async () => {
        await pending({ rideId: 'other', ownerId: 'cap2', rideSnapshot: { pickup: 'Endereço privado' } }); mount()
        await screen.findByRole('button', { name: /voltar para corrida/i })
        expect(screen.queryByText('Endereço privado')).toBeNull()
    })
    it('mantém a pendência e expõe o motivo quando o servidor recusa', async () => {
        await pending({ lastError: 'Distância insuficiente.' }); mount()
        expect(await screen.findByRole('alert')).toHaveTextContent('Distância insuficiente')
        expect(screen.queryByRole('button', { name: /voltar para corrida/i })).toBeNull()
        expect(await db.offlineActions.count()).toBe(1)
    })
    it('atualiza para finalizada após ACK remover a pendência, sem duplicar a linha', async () => {
        const id = await pending(); mount()
        await screen.findByText('Finalização pendente')
        api.get.mockResolvedValue({ data: { activeRide: null, rides: [{ ...ride, status: 'finished', finalPrice: 8.59 }] } })
        await act(async () => { await db.offlineActions.delete(id) })
        expect(await screen.findByText('Finalizada')).toBeInTheDocument()
        expect(screen.queryByText('Finalização pendente')).toBeNull()
        expect(screen.getAllByText('Rua A')).toHaveLength(1)
    })
    it('corrida sem pendência continua acessível', async () => {
        mount()
        fireEvent.click(await screen.findByRole('button', { name: /voltar para corrida/i }))
        await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/captain-riding', { state: { ride } }))
    })
})
