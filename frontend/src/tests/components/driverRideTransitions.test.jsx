import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    get: vi.fn(), post: vi.fn(), enqueue: vi.fn(), navigate: vi.fn(), toast: vi.fn(),
    setCaptainRide: vi.fn(), setRide: vi.fn(), confirmPanel: vi.fn(), offerPanel: vi.fn(),
}))
vi.mock('@/shared/services/axios', () => ({ default: { get: mocks.get, post: mocks.post } }))
vi.mock('@/shared/services/offlineQueue', () => ({ enqueueOfflineAction: mocks.enqueue }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('@/shared/components/PassengerIdentityCard', () => ({ default: () => null }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }))
vi.mock('@/shared/contexts/RideContext', async () => ({ RideContext: (await import('react')).createContext({}) }))
vi.mock('@/driver/contexts/CaptainContext', async () => ({ CaptainDataContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/contexts/LocationContext', async () => ({ LocationContext: (await import('react')).createContext({}) }))

import RidePopUp from '@/driver/components/RidePopUp'
import ConfirmRidePopUp from '@/driver/components/ConfirmRidePopUp'
import { RideContext } from '@/shared/contexts/RideContext'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'

const ride = { _id: 'ride-1', captain: { _id: 'captain-1' }, status: 'arrived', pickup: 'Rua A', destination: 'Rua B' }
const deferred = () => {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}
function pickup(currentRide = ride) {
    return <CaptainDataContext.Provider value={{ captain: { _id: 'captain-1' } }}>
        <RideContext.Provider value={{ setCaptainRide: mocks.setCaptainRide }}>
            <ConfirmRidePopUp ride={currentRide} setRide={mocks.setRide}
                setConfirmRidePopupPanel={mocks.confirmPanel} setRidePopupPanel={mocks.offerPanel} />
        </RideContext.Provider>
    </CaptainDataContext.Provider>
}

beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    mocks.enqueue.mockResolvedValue(1)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('oferta: confirmação antes do próximo painel', () => {
    it('não abre o embarque antes do ACK e bloqueia clique duplo', async () => {
        const ack = deferred()
        const confirm = vi.fn(() => ack.promise)
        render(<RidePopUp ride={{ ...ride, status: 'requested' }} confirmRide={confirm}
            setConfirmRidePopupPanel={mocks.confirmPanel} />)
        const accept = screen.getByRole('button', { name: 'Aceitar' })
        fireEvent.click(accept)
        fireEvent.click(accept)
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(mocks.confirmPanel).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Ignorar' })).toBeDisabled()
        await act(async () => ack.resolve())
    })
})

describe('embarque: gravação durável antes de avançar', () => {
    it.each([
        ['accepted', 'Corrida aceita', 'A caminho'],
        ['going_to_pickup', 'Indo buscar o passageiro', 'Cheguei ao local'],
        ['arrived', 'Você chegou ao embarque', 'Iniciar corrida'],
        ['waiting_passenger', 'Você chegou ao embarque', 'Iniciar corrida'],
    ])('orienta a etapa %s sem antecipar o início', (status, title, action) => {
        render(pickup({ ...ride, status }))
        expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: action })).toBeEnabled()
        expect(mocks.post).not.toHaveBeenCalled()
        expect(mocks.get).not.toHaveBeenCalled()
    })
    it('mantém endereço completo e abre o embarque, não o destino', () => {
        render(pickup({ ...ride, pickup: 'Rua A, 123, bairro Centro', destination: 'Rua B, 456',
            pickupCoordinates: { lat: -20.1, lng: -41.6 }, estimatedDistance: 8000 }))
        expect(screen.getByText('Rua A, 123, bairro Centro')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Abrir embarque no Google Maps' })).toHaveAttribute('href', expect.stringContaining('destination=-20.1,-41.6'))
        expect(screen.getByText(/Percurso previsto da viagem/)).toHaveTextContent('Não é a distância até o passageiro')
    })
    it('não inventa local de embarque quando dados faltam', () => {
        render(pickup({ ...ride, pickup: null }))
        expect(screen.getByText('Endereço de embarque indisponível')).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Abrir embarque no Google Maps' })).not.toBeInTheDocument()
    })
    it('oferece ligação apenas com o telefone autorizado após o aceite', () => {
        render(pickup({ ...ride, user: { phone: '+55 (33) 99999-9999' } }))
        expect(screen.getByRole('link', { name: 'Ligar para o passageiro' })).toHaveAttribute('href', 'tel:+5533999999999')
    })
    it.each([null, 'javascript:alert(123456789)', '*123456789#'])('não inventa nem executa telefone inválido: %s', phone => {
        render(pickup({ ...ride, user: { phone } }))
        expect(screen.queryByRole('link', { name: 'Ligar para o passageiro' })).not.toBeInTheDocument()
        expect(screen.getByText('Telefone do passageiro não informado.')).toBeInTheDocument()
    })
    it('espera a gravação após timeout nativo, mesmo com navigator online', async () => {
        const saved = deferred()
        mocks.get.mockRejectedValue(Object.assign(new Error('CONNECTIVITY_TIMEOUT'), { isConnectivityIssue: true }))
        mocks.enqueue.mockReturnValue(saved.promise)
        render(pickup())
        const start = screen.getByRole('button', { name: 'Iniciar corrida' })
        fireEvent.click(start)
        fireEvent.click(start)
        await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1))
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.setCaptainRide).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
        expect(screen.getByRole('status')).toHaveTextContent('Salvando no aparelho')
        await act(async () => saved.resolve(1))
        await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))
        const occurredAt = mocks.get.mock.calls[0][1].params.occurredAt
        expect(mocks.enqueue.mock.calls[0][0].payload.occurredAt).toBe(occurredAt)
        expect(mocks.setCaptainRide).toHaveBeenCalledWith(expect.objectContaining({
            _id: ride._id, status: 'started', startedAt: new Date(occurredAt).toISOString(),
        }))
    })

    it('mantém o embarque se o armazenamento falhar', async () => {
        mocks.get.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))
        mocks.enqueue.mockRejectedValue(new Error('QuotaExceededError'))
        render(pickup())
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar corrida' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/salvar.*aparelho/i), 'error'))
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.setCaptainRide).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Iniciar corrida' })).toBeEnabled()
    })

    it.each(['going_to_pickup', 'arrived'])('só avança para %s depois de salvar', async status => {
        const saved = deferred()
        mocks.post.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
        mocks.enqueue.mockReturnValue(saved.promise)
        render(pickup({ ...ride, status: status === 'arrived' ? 'going_to_pickup' : 'accepted' }))
        fireEvent.click(screen.getByRole('button', { name: status === 'arrived' ? 'Cheguei ao local' : 'A caminho' }))
        await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1))
        expect(mocks.setCaptainRide).not.toHaveBeenCalled()
        await act(async () => saved.resolve(1))
        await waitFor(() => expect(mocks.setCaptainRide).toHaveBeenCalledWith(expect.objectContaining({ status })))
    })

    it.each([400, 401, 403, 409])('não trata HTTP %s como início offline, mesmo sem sinal', async status => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
        mocks.get.mockRejectedValue({ response: { status, data: { message: 'Recusado pelo servidor' } } })
        render(pickup())
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar corrida' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalled())
        expect(mocks.enqueue).not.toHaveBeenCalled()
        expect(mocks.navigate).not.toHaveBeenCalled()
    })

    it.each([null, {}, { ...ride, status: 'requested' }, { ...ride, captain: 'other' }])('não oferece ações para corrida sem atribuição válida (%j)', current => {
        render(pickup(current))
        expect(screen.queryByRole('button', { name: /^(Iniciar corrida|A caminho|Cheguei ao local)$/ })).toBeNull()
        expect(mocks.get).not.toHaveBeenCalled()
        expect(mocks.post).not.toHaveBeenCalled()
    })

    it('não aplica uma resposta atrasada sobre outra corrida', async () => {
        const ack = deferred()
        mocks.get.mockReturnValue(ack.promise)
        const view = render(pickup())
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar corrida' }))
        view.rerender(pickup({ ...ride, _id: 'ride-2' }))
        await act(async () => ack.resolve({ status: 200, data: { ...ride, status: 'started' } }))
        expect(mocks.navigate).not.toHaveBeenCalled()
        expect(mocks.setCaptainRide).not.toHaveBeenCalled()
    })

    it('inicia normalmente com o DTO autenticado que omite captain', async () => {
        const dto = { ...ride, captain: undefined }
        mocks.get.mockResolvedValue({ data: { ...dto, status: 'started' } })
        render(pickup(dto))
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar corrida' }))
        await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))
        expect(mocks.enqueue).not.toHaveBeenCalled()
    })

    it('não regride a chegada recebida enquanto A caminho estava pendente', async () => {
        const ack = deferred()
        mocks.post.mockReturnValue(ack.promise)
        const view = render(pickup({ ...ride, status: 'accepted' }))
        fireEvent.click(screen.getByRole('button', { name: 'A caminho' }))
        view.rerender(pickup(ride))
        await act(async () => ack.resolve({ data: { ...ride, status: 'going_to_pickup' } }))
        expect(mocks.setRide).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Iniciar corrida' })).toBeEnabled()
    })

    it('grava após o teto de 12 segundos de uma chamada nativa pendurada', async () => {
        vi.useFakeTimers()
        mocks.get.mockReturnValue(new Promise(() => {}))
        render(pickup())
        const occurredAt = Date.now()
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar corrida' }))
        await act(async () => vi.advanceTimersByTimeAsync(11999))
        expect(mocks.enqueue).not.toHaveBeenCalled()
        expect(mocks.navigate).not.toHaveBeenCalled()
        await act(async () => vi.advanceTimersByTimeAsync(1))
        expect(mocks.enqueue).toHaveBeenCalledTimes(1)
        expect(mocks.enqueue.mock.calls[0][0].payload.occurredAt).toBe(occurredAt)
        expect(mocks.navigate).toHaveBeenCalledTimes(1)
    })

    it('não limpa outra corrida depois de uma resposta atrasada de cancelamento', async () => {
        const ack = deferred()
        mocks.post.mockReturnValue(ack.promise)
        const view = render(pickup({ ...ride, status: 'accepted' }))
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }))
        view.rerender(pickup({ ...ride, _id: 'ride-2' }))
        await act(async () => ack.resolve({ data: {} }))
        expect(mocks.setCaptainRide).not.toHaveBeenCalled()
        expect(mocks.confirmPanel).not.toHaveBeenCalled()
    })
})
