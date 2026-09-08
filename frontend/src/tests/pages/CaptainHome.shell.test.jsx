import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    get: vi.fn(), post: vi.fn(), toast: vi.fn(), requestLock: vi.fn(), alert: vi.fn(), setCaptain: vi.fn(),
    acceptParcel: vi.fn(), parcelHistory: vi.fn(), setCaptainRide: vi.fn(), setCaptainParcel: vi.fn(),
    socket: { connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}))
vi.mock('@/shared/services/axios', () => ({ default: { get: mocks.get, post: mocks.post } }))
vi.mock('@/shared/services/offlineQueue', () => ({
    enqueueOfflineAction: vi.fn(), flushQueuedLocations: vi.fn(), replayOfflineActions: vi.fn(),
    hasPendingFinalization: async () => false,
}))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }))
vi.mock('@/shared/contexts/PwaUpdateContext', () => ({ usePwaUpdate: () => ({ checkForUpdate: vi.fn() }) }))
vi.mock('@/shared/contexts/RideContext', async () => ({ RideContext: (await import('react')).createContext({}) }))
vi.mock('@/driver/contexts/CaptainContext', async () => ({ CaptainDataContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/contexts/LocationContext', async () => ({ LocationContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/contexts/SocketContext', async () => ({ SocketContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/services/parcelApi', () => ({ getPendingParcels: async () => [], getCaptainParcelHistory: mocks.parcelHistory, acceptParcel: mocks.acceptParcel, declineParcel: vi.fn() }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }))
vi.mock('@/shared/services/db', () => ({ db: {} }))
vi.mock('@/shared/services/fcm', () => ({ onForegroundMessage: () => () => {} }))
vi.mock('@/shared/platform/notification.service', () => ({ bindPushNavigation: async () => () => {} }))
vi.mock('@/shared/platform/platform', () => ({ isNativePlatform: () => false }))
vi.mock('@/shared/hooks/useWakeLock', () => ({ useWakeLock: () => ({ requestLock: mocks.requestLock }) }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: () => 'test-token', getSessionOwnerId: () => 'c1' }))
vi.mock('@/shared/services/socketAuth', () => ({ joinWithRetry: vi.fn() }))
vi.mock('@/shared/services/browserNotify', () => ({ showBrowserNotification: vi.fn() }))
vi.mock('@/shared/platform/nativeRideOffer.service', () => ({ presentNativeRideOffer: vi.fn() }))
vi.mock('@/shared/services/rideOffer/useOfferAlert', () => ({ useOfferAlert: mocks.alert }))
vi.mock('@/driver/components/CaptainDetails', () => ({ default: ({ children, onAvailabilityBusyChange }) => <div>
    <button onClick={() => onAvailabilityBusyChange(true)}>Teste: disponibilidade pendente</button>
    <button onClick={() => onAvailabilityBusyChange(false)}>Teste: disponibilidade confirmada</button>
    {children}
</div> }))
vi.mock('@/driver/components/ApprovalGate', () => ({ default: ({ onRefresh }) => <><p>Aprovação necessária</p><button onClick={() => onRefresh()}>Consultar aprovação</button></> }))
vi.mock('@/shared/components/LiveTracking', () => ({ default: () => <div data-testid="persistent-map" /> }))
vi.mock('@/shared/components/PassengerIdentityCard', () => ({ default: () => null }))
vi.mock('@/shared/components/ui/InstallAppButton', () => ({ default: () => null }))
vi.mock('@/shared/components/NotificationBell', () => ({ default: () => null }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

import CaptainHome from '@/driver/pages/CaptainHome'
import CaptainEarnings from '@/driver/pages/CaptainEarnings'
import CaptainRidesHistory from '@/driver/pages/CaptainRidesHistory'
import CaptainParcels from '@/driver/pages/CaptainParcels'
import CaptainSupport from '@/driver/pages/CaptainSupport'
import { RideContext } from '@/shared/contexts/RideContext'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { dismissDriverOverlay } from '@/shared/services/driverOverlayBack'

const captain = { _id: 'c1', approvalStatus: 'aprovado', isOnline: true }
const offer = () => ({ _id: 'r1', status: 'requested', pickup: 'Rua A', destination: 'Rua B', offerExpiresAt: new Date(Date.now() + 60_000).toISOString() })
function Path() { return <output data-testid="path">{useLocation().pathname}</output> }
function home({ path = '/captain/earnings', ride = null, parcel = null, owner = captain } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
        <CaptainDataContext.Provider value={{ captain: owner, setCaptain: mocks.setCaptain }}>
            <SocketContext.Provider value={{ socket: mocks.socket }}>
                <RideContext.Provider value={{ captainRide: ride, captainParcel: parcel, setCaptainRide: mocks.setCaptainRide, setCaptainParcel: mocks.setCaptainParcel }}>
                    <Routes><Route element={<CaptainHome />}>
                        <Route path="/captain-home" element={null} />
                        <Route path="/captain/earnings" element={<CaptainEarnings />} />
                        <Route path="/captain/profile" element={<p>Perfil em edição</p>} />
                        <Route path="/captain/support" element={<CaptainSupport />} />
                        <Route path="/captain/rides" element={<CaptainRidesHistory />} />
                        <Route path="/captain/parcels" element={<CaptainParcels />} />
                    </Route><Route path="/captain-parcel" element={<p>Encomenda confirmada</p>} /></Routes><Path />
                </RideContext.Provider>
            </SocketContext.Provider>
        </CaptainDataContext.Provider>
    </MemoryRouter></QueryClientProvider>
    const view = render(tree())
    return { ...view, changeOwner(next) { owner = next; view.rerender(tree()) }, changeRide(next) { ride = next; view.rerender(tree()) } }
}
async function emit(event, data) {
    await waitFor(() => expect(mocks.socket.on.mock.calls.some(([name]) => name === event)).toBe(true))
    act(() => mocks.socket.on.mock.calls.filter(([name]) => name === event).at(-1)[1](data))
}
beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    mocks.parcelHistory.mockResolvedValue({ parcels: [], pendingOffers: [] })
    mocks.get.mockImplementation(async url => {
        if (url === '/rides/pending') return { data: [] }
        return { data: { upcoming: [], days: [], totalEarnings: 0 } }
    })
})
afterEach(() => vi.restoreAllMocks())

describe('lote 3: shell e atendimento acima das páginas', () => {
    it('lote 7: consulta de aprovação é única e exige perfil da mesma conta', async () => {
        let resolve
        mocks.get.mockImplementation(url => url === '/captains/profile' ? new Promise(done => { resolve = done }) : Promise.resolve({ data: [] }))
        const owner = { ...captain, approvalStatus: 'em_analise', isOnline: false }
        home({ owner, path: '/captain-home' })
        fireEvent.click(screen.getByRole('button', { name: 'Consultar aprovação' }))
        fireEvent.click(screen.getByRole('button', { name: 'Consultar aprovação' }))
        expect(mocks.get.mock.calls.filter(([url]) => url === '/captains/profile')).toHaveLength(1)
        await act(async () => resolve({ data: { captain: { ...owner, approvalStatus: 'aprovado' } } }))
        expect(mocks.setCaptain).toHaveBeenCalledTimes(1)
        expect(mocks.setCaptain.mock.calls[0][0](owner).approvalStatus).toBe('aprovado')
    })
    it('lote 7: perfil antigo não apaga documento recém-confirmado', async () => {
        let resolve
        mocks.get.mockImplementation(url => url === '/captains/profile' ? new Promise(done => { resolve = done }) : Promise.resolve({ data: [] }))
        const owner = { ...captain, approvalStatus: 'em_analise', isOnline: false }
        const view = home({ owner, path: '/captain-home' })
        fireEvent.click(screen.getByRole('button', { name: 'Consultar aprovação' }))
        view.changeOwner({ ...owner, documents: { cnhBack: { url: 'https://example.test/new.jpg' } } })
        await act(async () => resolve({ data: { captain: owner } }))
        expect(mocks.setCaptain).not.toHaveBeenCalled()
    })
    it('lote 7: resposta de conta diferente não substitui o cadastro', async () => {
        mocks.get.mockImplementation(async url => ({ data: url === '/captains/profile' ? { captain: { ...captain, _id: 'c2' } } : [] }))
        home({ owner: { ...captain, approvalStatus: 'em_analise', isOnline: false }, path: '/captain-home' })
        fireEvent.click(screen.getByRole('button', { name: 'Consultar aprovação' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('Não foi possível atualizar'), 'error'))
        expect(mocks.setCaptain).not.toHaveBeenCalled()
    })
    it('lote 7: consulta não atualiza a conta depois de sair da Home', async () => {
        let resolve
        mocks.get.mockImplementation(url => url === '/captains/profile' ? new Promise(done => { resolve = done }) : Promise.resolve({ data: [] }))
        const owner = { ...captain, approvalStatus: 'em_analise', isOnline: false }
        const view = home({ owner, path: '/captain-home' })
        fireEvent.click(screen.getByRole('button', { name: 'Consultar aprovação' }))
        view.unmount()
        await act(async () => resolve({ data: { captain: owner } }))
        expect(mocks.setCaptain).not.toHaveBeenCalled()
    })
    it('lote 4: disponibilidade pendente bloqueia oferta e presencial, sem perder a oferta', async () => {
        home({ path: '/captain-home' })
        fireEvent.click(screen.getByRole('button', { name: 'Teste: disponibilidade pendente' }))
        await emit('new-ride', offer())
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Iniciar uma corrida presencial' })).toBeDisabled()
        expect(screen.getByRole('link', { name: 'Conferir disponibilidade no início' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Teste: disponibilidade confirmada' }))
        expect(await screen.findByRole('dialog', { name: 'Oferta de corrida' })).toBeInTheDocument()
    })
    it('monta apenas um cabeçalho em Ganhos', async () => {
        home()
        expect(await screen.findAllByRole('button', { name: 'Abrir menu' })).toHaveLength(1)
    })
    it.each(['/captain/earnings', '/captain/profile', '/captain/support'])('mostra a oferta fora do shell em %s, sem trocar a página', async path => {
        home({ path })
        await emit('new-ride', offer())
        const dialog = await screen.findByRole('dialog', { name: 'Oferta de corrida' })
        expect(within(dialog).getByRole('button', { name: 'Aceitar' })).toBeEnabled()
        expect(dialog.closest('[data-driver-shell]')).toBeNull()
        expect(document.querySelector('[data-driver-shell]').inert).toBe(true)
        expect(screen.getByTestId('path')).toHaveTextContent(path)
    })
    it('não exibe nem toca ofertas vencidas recebidas pelo socket', async () => {
        home()
        await emit('new-ride', { ...offer(), offerExpiresAt: new Date(Date.now() - 1).toISOString() })
        expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull()
        expect(mocks.alert).not.toHaveBeenCalledWith('r1')
    })
    it('não apresenta oferta de corrida enquanto existe encomenda ativa', async () => {
        home({ parcel: { _id: 'p0', status: 'in_transit' } })
        await emit('new-ride', offer())
        expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull()
        expect(mocks.alert).not.toHaveBeenCalledWith('r1')
    })
    it('fechar o embarque mantém um caminho para retomar a mesma corrida', async () => {
        const ride = { ...offer(), status: 'accepted' }
        home({ ride })
        fireEvent.click(await screen.findByRole('button', { name: 'Recolher atendimento' }))
        expect(screen.queryByRole('dialog')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Retomar embarque' }))
        expect(await screen.findByRole('button', { name: 'A caminho' })).toBeEnabled()
        expect(mocks.post).not.toHaveBeenCalled()
        expect(screen.getByTestId('path')).toHaveTextContent('/captain/earnings')
    })
    it('oferta recuperada por consulta também aparece sobre Ganhos', async () => {
        const data = offer()
        mocks.get.mockImplementation(async url => ({ data: url === '/rides/pending' ? [data] : { upcoming: [], totalEarnings: 0 } }))
        home()
        expect(await screen.findByRole('dialog', { name: 'Oferta de corrida' })).toBeInTheDocument()
    })
    it('mistura corrida/encomenda numa única camada e avança após recusa explícita', async () => {
        home()
        await emit('new-ride', offer())
        await emit('new-parcel', { ...offer(), _id: 'p1', itemName: 'Pacote' })
        await emit('new-ride', offer())
        expect(screen.getAllByRole('dialog')).toHaveLength(1)
        fireEvent.click(screen.getByRole('button', { name: 'Ignorar' }))
        expect(await screen.findByRole('dialog', { name: 'Oferta de encomenda' })).toBeInTheDocument()
        expect(screen.getAllByRole('dialog')).toHaveLength(1)
        expect(mocks.post).toHaveBeenCalledWith('/rides/r1/decline', {})
    })
    it.each(['ride-cancelled', 'ride-taken'])('%s retira a oferta sem sair do Perfil', async event => {
        home({ path: '/captain/profile' })
        await emit('new-ride', offer())
        await emit(event, { rideId: 'r1', captainId: 'other' })
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(screen.getByTestId('path')).toHaveTextContent('/captain/profile')
    })
    it('Voltar recolhe sem recusar e a oferta pode ser reaberta com o prazo original', async () => {
        home()
        await emit('new-ride', offer())
        act(() => expect(dismissDriverOverlay()).toBe(true))
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(mocks.post).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Ver oferta disponível' }))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByTestId('path')).toHaveTextContent('/captain/earnings')
    })
    it('não revive oferta recolhida que expirou enquanto o app estava suspenso', async () => {
        home()
        const now = Date.now()
        await emit('new-ride', { ...offer(), offerExpiresAt: new Date(now + 1000).toISOString() })
        fireEvent.click(screen.getByRole('button', { name: 'Recolher atendimento' }))
        vi.spyOn(Date, 'now').mockReturnValue(now + 2000)
        await act(async () => window.dispatchEvent(new Event('pageshow')))
        expect(screen.queryByRole('button', { name: 'Ver oferta disponível' })).toBeNull()
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(mocks.post).not.toHaveBeenCalled()
    })
    it('fecha o menu quando chega uma oferta e preserva o mapa entre páginas', async () => {
        home()
        const map = screen.getByTestId('persistent-map')
        fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
        expect(screen.getByRole('navigation')).toBeInTheDocument()
        await emit('new-ride', offer())
        expect(screen.queryByRole('navigation')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Recolher atendimento' }))
        fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
        fireEvent.click(screen.getByRole('link', { name: 'Perfil' }))
        expect(screen.getByText('Perfil em edição')).toBeInTheDocument()
        expect(screen.getByTestId('persistent-map')).toBe(map)
    })
    it.each([
        { ...captain, isOnline: false },
        { ...captain, isBlocked: true },
        { ...captain, approvalStatus: 'pendente' },
    ])('não exibe oferta para motorista indisponível: %j', async owner => {
        home({ owner })
        await emit('new-ride', offer())
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(mocks.alert).not.toHaveBeenCalledWith('r1')
    })
    it('uma resposta de consulta atrasada não revive oferta já tomada', async () => {
        let resolve
        mocks.get.mockImplementation(url => url === '/rides/pending'
            ? new Promise(yes => { resolve = yes }) : Promise.resolve({ data: { upcoming: [], totalEarnings: 0 } }))
        home()
        await emit('new-ride', offer())
        await emit('ride-taken', { rideId: 'r1', captainId: 'other' })
        await act(async () => resolve({ data: [offer()] }))
        expect(screen.queryByRole('dialog')).toBeNull()
    })
    it('não troca a oferta de encomenda durante o aceite nem permite clique duplo', async () => {
        let resolve
        mocks.acceptParcel.mockReturnValue(new Promise(yes => { resolve = yes }))
        home()
        await emit('new-parcel', { ...offer(), _id: 'p1', itemName: 'Pacote' })
        fireEvent.click(screen.getByRole('button', { name: 'Aceitar' }))
        expect(screen.getByRole('button', { name: 'Recolher atendimento' })).toBeDisabled()
        await emit('new-ride', offer())
        expect(screen.getByRole('dialog', { name: 'Oferta de encomenda' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Aceitando...' }))
        expect(mocks.acceptParcel).toHaveBeenCalledTimes(1)
        await act(async () => resolve({ _id: 'p1', status: 'provider_accepted' }))
        expect(mocks.setCaptainParcel).toHaveBeenCalledWith({ _id: 'p1', status: 'provider_accepted' })
    })
    it('descarta consulta atrasada de outra conta e limpa o atendimento anterior', async () => {
        const resolvers = []
        mocks.get.mockImplementation(url => url === '/rides/pending'
            ? new Promise(yes => { resolvers.push(yes) }) : Promise.resolve({ data: { upcoming: [], totalEarnings: 0 } }))
        const view = home()
        await emit('new-ride', offer())
        view.changeOwner({ ...captain, _id: 'c2' })
        expect(screen.queryByRole('dialog')).toBeNull()
        await act(async () => resolvers[0]({ data: [offer()] }))
        expect(screen.queryByRole('dialog')).toBeNull()
        await act(async () => resolvers.at(-1)({ data: [] }))
    })
    it('remove o atalho local quando o contexto confirma o encerramento do serviço', async () => {
        const view = home({ ride: { ...offer(), status: 'accepted' } })
        expect(await screen.findByRole('button', { name: 'A caminho' })).toBeInTheDocument()
        view.changeRide(null)
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(screen.queryByRole('button', { name: 'Retomar embarque' })).toBeNull()
    })
    it('destaque vencido não cancela solicitação ainda retornada por pending', async () => {
        const pending = { ...offer(), offerExpiresAt: new Date(Date.now() - 1000).toISOString() }
        mocks.get.mockImplementation(async url => ({ data: url === '/rides/pending' ? [pending] : { upcoming: [] } }))
        mocks.post.mockResolvedValue({ data: { ...pending, status: 'accepted' } })
        home({ path: '/captain-home' })
        fireEvent.click(await screen.findByRole('button', { name: 'Aceitar corrida' }))
        expect(await screen.findByRole('button', { name: 'A caminho' })).toBeInTheDocument()
        expect(mocks.setCaptainRide).toHaveBeenCalledWith(expect.objectContaining({ _id: 'r1', status: 'accepted' }))
    })
    it('aceite pelo histórico usa a trava global e não avança sem ACK', async () => {
        let resolve
        mocks.post.mockReturnValue(new Promise(yes => { resolve = yes }))
        mocks.get.mockImplementation(async url => ({ data: url.endsWith('/rides/captain-history')
            ? { rides: [], pendingOffers: [offer()] } : url === '/rides/pending' ? [] : { upcoming: [] } }))
        home({ path: '/captain/rides' })
        fireEvent.click(await screen.findByRole('button', { name: 'Aceitar corrida' }))
        expect(screen.queryByRole('button', { name: 'A caminho' })).toBeNull()
        await emit('new-parcel', { ...offer(), _id: 'p1' })
        expect(screen.queryByRole('dialog', { name: 'Oferta de encomenda' })).toBeNull()
        expect(mocks.post).toHaveBeenCalledTimes(1)
        await act(async () => resolve({ data: { ...offer(), status: 'accepted' } }))
        expect(await screen.findByRole('button', { name: 'A caminho' })).toBeInTheDocument()
        expect(screen.getByTestId('path')).toHaveTextContent('/captain/rides')
    })
    it('aceite pela lista de encomendas também bloqueia ofertas concorrentes', async () => {
        let resolve
        const pending = { ...offer(), _id: 'p1', status: 'awaiting_provider', itemName: 'Pacote', offerExpiresAt: new Date(Date.now() - 1000).toISOString() }
        mocks.parcelHistory.mockResolvedValue({ parcels: [], pendingOffers: [pending] })
        mocks.acceptParcel.mockReturnValue(new Promise(yes => { resolve = yes }))
        home({ path: '/captain/parcels' })
        fireEvent.click(await screen.findByRole('button', { name: 'Aceitar encomenda' }))
        await emit('new-ride', offer())
        expect(screen.getByRole('dialog', { name: 'Oferta de encomenda' })).toBeInTheDocument()
        expect(screen.queryByRole('dialog', { name: 'Oferta de corrida' })).toBeNull()
        expect(mocks.acceptParcel).toHaveBeenCalledTimes(1)
        await act(async () => resolve({ ...pending, status: 'provider_accepted' }))
        expect(screen.getByTestId('path')).toHaveTextContent('/captain-parcel')
    })
})
