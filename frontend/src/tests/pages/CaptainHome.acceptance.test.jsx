import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    get: vi.fn(), post: vi.fn(), setCaptainRide: vi.fn(), toast: vi.fn(), enqueueOffline: vi.fn(),
    socket: { connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    queue: { active: null, enqueue: vi.fn(), remove: vi.fn(), clear: vi.fn() },
    requestLock: vi.fn(), syncRide: vi.fn(),
}))
vi.mock('@/shared/services/axios', () => ({ default: { get: mocks.get, post: mocks.post } }))
vi.mock('@/shared/services/offlineQueue', () => ({
    enqueueOfflineAction: mocks.enqueueOffline, flushQueuedLocations: vi.fn(), replayOfflineActions: vi.fn(),
    hasPendingFinalization: async () => false,
}))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }))
vi.mock('@/shared/contexts/RideContext', async () => ({ RideContext: (await import('react')).createContext({}) }))
vi.mock('@/driver/contexts/CaptainContext', async () => ({ CaptainDataContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/contexts/LocationContext', async () => ({ LocationContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/contexts/SocketContext', async () => ({ SocketContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/services/parcelApi', () => ({ getPendingParcels: async () => [], acceptParcel: vi.fn(), declineParcel: vi.fn() }))
vi.mock('@/shared/services/fcm', () => ({ onForegroundMessage: () => () => {} }))
vi.mock('@/shared/platform/notification.service', () => ({ bindPushNavigation: async () => () => {} }))
vi.mock('@/shared/platform/platform', () => ({ isNativePlatform: () => false }))
vi.mock('@/shared/hooks/useWakeLock', () => ({ useWakeLock: () => ({ requestLock: mocks.requestLock }) }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: () => 'token' }))
vi.mock('@/shared/services/socketAuth', () => ({ joinWithRetry: vi.fn() }))
vi.mock('@/shared/services/browserNotify', () => ({ showBrowserNotification: vi.fn() }))
vi.mock('@/shared/platform/nativeRideOffer.service', () => ({ presentNativeRideOffer: vi.fn() }))
vi.mock('@/shared/services/rideOffer/useOfferQueue', () => ({ useOfferQueue: () => mocks.queue }))
vi.mock('@/shared/services/rideOffer/useOfferAlert', () => ({ useOfferAlert: vi.fn() }))
vi.mock('@/shared/services/rideOffer/useOfferCountdown', () => ({ useOfferCountdown: () => ({ expired: false, remainingSeconds: 60 }) }))
vi.mock('@/driver/components/CaptainDetails', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('@/driver/components/CaptainHeader', () => ({ default: () => null }))
vi.mock('@/driver/components/ApprovalGate', () => ({ default: () => null }))
vi.mock('@/driver/components/ParcelPopUp', () => ({ default: () => null }))
vi.mock('@/shared/components/LiveTracking', () => ({ default: () => null }))
vi.mock('@/shared/components/ui/ConnectionBanner', () => ({ default: () => null }))
vi.mock('@/shared/components/PassengerIdentityCard', () => ({ default: () => null }))
vi.mock('@/shared/components/ui/BottomSheet', () => ({ default: ({ open, children }) => open ? <div>{children}</div> : null }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

import CaptainHome from '@/driver/pages/CaptainHome'
import { RideContext } from '@/shared/contexts/RideContext'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { SocketContext } from '@/shared/contexts/SocketContext'

const offer = { _id: 'r1', status: 'requested', pickup: 'Rua A', destination: 'Rua B' }
const assigned = { ...offer, status: 'accepted' }
const captain = { _id: 'c1', approvalStatus: 'aprovado' }
function home() {
    return render(<MemoryRouter initialEntries={['/captain-home']}>
        <CaptainDataContext.Provider value={{ captain }}>
            <SocketContext.Provider value={{ socket: mocks.socket }}>
                <RideContext.Provider value={{ captainRide: null, setCaptainRide: mocks.setCaptainRide, syncCaptainRide: mocks.syncRide }}>
                    <CaptainHome />
                </RideContext.Provider>
            </SocketContext.Provider>
        </CaptainDataContext.Provider>
    </MemoryRouter>)
}
const deferred = () => {
    let resolve
    const promise = new Promise(yes => { resolve = yes })
    return { promise, resolve }
}
beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    mocks.queue.active = { kind: 'ride', offerId: offer._id, data: offer }
    mocks.get.mockImplementation(async url => {
        if (url === '/rides/pending') return { data: [offer] }
        if (url === '/rides/captain-current') throw { response: { status: 404 } }
        return { data: { upcoming: [] } }
    })
})
afterEach(() => vi.restoreAllMocks())

describe('CaptainHome: aceite operacional', () => {
    it('só abre A caminho após o ACK e trava também o card alternativo', async () => {
        const ack = deferred()
        mocks.post.mockReturnValue(ack.promise)
        home()
        fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }))
        expect(screen.queryByRole('button', { name: 'A caminho' })).toBeNull()
        const cardAccept = await screen.findByRole('button', { name: 'Aceitar corrida' })
        expect(cardAccept).toBeDisabled()
        fireEvent.click(cardAccept)
        expect(mocks.post).toHaveBeenCalledTimes(1)
        await act(async () => ack.resolve({ data: assigned }))
        expect(await screen.findByRole('button', { name: 'A caminho' })).toBeEnabled()
        expect(mocks.setCaptainRide).toHaveBeenCalledWith(assigned)
    })

    it('não fabrica aceite offline e permite verificar a atribuição depois', async () => {
        mocks.post.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))
        home()
        fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }))
        const retry = await screen.findByRole('button', { name: 'Tentar confirmar aceite' })
        expect(mocks.enqueueOffline).not.toHaveBeenCalled()
        expect(mocks.setCaptainRide).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: 'A caminho' })).toBeNull()
        expect(screen.getByRole('button', { name: 'GO — Iniciar uma corrida presencial' })).toBeDisabled()
        mocks.get.mockResolvedValue({ data: assigned })
        fireEvent.click(retry)
        expect(await screen.findByRole('button', { name: 'A caminho' })).toBeEnabled()
        expect(mocks.post).toHaveBeenCalledTimes(1)
    })

    it('não avança quando outro motorista ganhou a corrida', async () => {
        mocks.post.mockRejectedValue({ response: { status: 409, data: { message: 'Outro motorista aceitou' } } })
        home()
        fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Outro motorista aceitou', 'info'))
        expect(mocks.setCaptainRide).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: 'A caminho' })).toBeNull()
    })

    it('cancelamento no socket vence uma resposta HTTP atrasada', async () => {
        const ack = deferred()
        mocks.post.mockReturnValue(ack.promise)
        home()
        fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }))
        const onCancel = mocks.socket.on.mock.calls.find(([event]) => event === 'ride-cancelled')[1]
        act(() => onCancel({ rideId: offer._id }))
        await act(async () => ack.resolve({ data: assigned }))
        expect(mocks.setCaptainRide).not.toHaveBeenCalledWith(assigned)
        expect(screen.queryByRole('button', { name: 'A caminho' })).toBeNull()
    })
})
