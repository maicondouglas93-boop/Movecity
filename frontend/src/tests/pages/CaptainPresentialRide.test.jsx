import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CaptainPresentialRide from '@/driver/pages/CaptainPresentialRide'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { RideContext } from '@/shared/contexts/RideContext'

const mocks = vi.hoisted(() => ({ create: vi.fn(), setRide: vi.fn(), toast: vi.fn() }))
vi.mock('@/shared/services/axios', () => ({ default: { post: vi.fn() } }))
vi.mock('@/shared/services/presentialRideApi', () => ({
    createPresentialRide: mocks.create,
    getPresentialVehicleOptions: async () => [{ name: 'car' }],
    estimatePresentialFare: vi.fn(),
    startPresentialRide: vi.fn(),
}))
vi.mock('@/shared/services/session', () => ({ getAccessToken: () => 'test-token' }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }))
vi.mock('@/shared/contexts/LocationContext', async () => ({ LocationContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/contexts/RideContext', async () => ({ RideContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/contexts/SocketContext', async () => ({ SocketContext: (await import('react')).createContext({ socket: null }) }))
vi.mock('@/driver/components/CaptainHeader', () => ({ default: () => null }))
vi.mock('@/shared/components/ui/ConnectionBanner', () => ({ default: () => null }))
vi.mock('@/shared/components/ui/AddressAutocomplete', () => ({ default: () => null }))

function mount() {
    return render(<MemoryRouter>
        <LocationContext.Provider value={{ userLocation: { lat: -20.15, lng: -41.62, timestamp: Date.now() } }}>
            <RideContext.Provider value={{ setCaptainRide: mocks.setRide }}>
                <CaptainPresentialRide />
            </RideContext.Provider>
        </LocationContext.Provider>
    </MemoryRouter>)
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockImplementation(async payload => ({ ...payload, _id: 'r1', source: 'driver_initiated', status: 'accepted' }))
})
afterEach(cleanup)

describe('nome do passageiro na corrida presencial', () => {
    it('pede nome e envia o nome sem espaços externos, sem telefone ou vínculo de conta', async () => {
        mount()
        fireEvent.click(screen.getByRole('button', { name: /Definir destino ao finalizar/ }))
        const input = screen.getByRole('textbox', { name: 'Nome do passageiro (opcional)' })
        expect(input).toHaveAttribute('type', 'text')
        expect(input).toHaveAttribute('maxlength', '100')
        expect(screen.queryByLabelText(/Telefone/)).not.toBeInTheDocument()
        fireEvent.change(input, { target: { value: '  João da Silva  ' } })
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar corrida' }))
        await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
        const payload = mocks.create.mock.calls[0][0]
        expect(payload.passengerName).toBe('João da Silva')
        expect(payload).not.toHaveProperty('passengerPhone')
        expect(payload).not.toHaveProperty('passengerUserId')
        await screen.findByRole('button', { name: 'Iniciar corrida' })
        expect(mocks.setRide).toHaveBeenCalledWith(expect.objectContaining({ passengerName: 'João da Silva' }))
    })

    it('permite criar a corrida deixando o nome em branco', async () => {
        mount()
        fireEvent.click(screen.getByRole('button', { name: /Definir destino ao finalizar/ }))
        fireEvent.change(screen.getByLabelText('Nome do passageiro (opcional)'), { target: { value: '   ' } })
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar corrida' }))
        await screen.findByRole('button', { name: 'Iniciar corrida' })
        expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('passengerName')
    })
})
