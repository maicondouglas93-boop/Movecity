import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), permission: vi.fn(), tracking: vi.fn(), toast: vi.fn(), change: vi.fn(), busy: vi.fn() }))
vi.mock('@/shared/services/axios', () => ({ default: { get: mocks.get, post: mocks.post } }))
vi.mock('@/shared/platform/location.service', () => ({ requestLocationPermission: mocks.permission, syncTrackingLifecycle: mocks.tracking }))
vi.mock('@/shared/platform/platform', () => ({ isNativePlatform: () => false }))
vi.mock('@/shared/platform/driverPermissions.service', () => ({ openDriverAppSettings: vi.fn() }))
vi.mock('@/driver/components/DriverPermissionsPanel', () => ({ default: () => null }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/driver/contexts/CaptainContext', async () => ({ CaptainDataContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/contexts/RideContext', async () => ({ RideContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/contexts/SocketContext', async () => ({ SocketContext: (await import('react')).createContext({}) }))
vi.mock('@/shared/contexts/LocationContext', async () => ({ LocationRefContext: (await import('react')).createContext({}) }))

import CaptainDetails from '@/driver/components/CaptainDetails'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'
import { driverAvailability, hasRecentLocation } from '@/driver/services/driverAvailability'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { LocationRefContext } from '@/shared/contexts/LocationContext'

const captain = { _id: 'owner-1', approvalStatus: 'aprovado', isOnline: false }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const socket = () => {
    const handlers = new Map()
    return { connected: true,
        on(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn) },
        off(event, fn) { handlers.get(event)?.delete(fn) },
        emit(event) { this.connected = event === 'connect'; handlers.get(event)?.forEach(fn => fn()) },
    }
}
function home({ owner = captain, busy = false, trip = null, error = null, location = { lat: 0, lng: 0, timestamp: Date.now() } } = {}) {
    const ws = socket()
    let changeOwner, changeTrip
    function Harness() {
        const [current, setCurrent] = useState(owner)
        const [ride, setRide] = useState(trip)
        changeOwner = setCurrent
        changeTrip = setRide
        return <CaptainDataContext.Provider value={{ captain: current, setCaptain: update => { mocks.change(update); setCurrent(update) } }}>
            <SocketContext.Provider value={{ socket: ws }}><LocationRefContext.Provider value={{ locationRef: { current: location }, locationError: error }}>
                <RideContext.Provider value={{ captainRide: ride }}>
                    <ConnectionBanner inline />
                    <CaptainDetails busy={busy} onAvailabilityBusyChange={mocks.busy} />
                </RideContext.Provider>
            </LocationRefContext.Provider></SocketContext.Provider>
        </CaptainDataContext.Provider>
    }
    return { ...render(<Harness />), ws, changeOwner: value => act(() => changeOwner(value)), changeTrip: value => act(() => changeTrip(value)) }
}
beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    mocks.get.mockResolvedValue({ data: { earnings: 42, ridesToday: 2, onlineTimeSeconds: 3600 } })
    mocks.permission.mockResolvedValue({ granted: true })
    mocks.tracking.mockResolvedValue({ started: true })
    mocks.post.mockResolvedValue({ data: { captain: { ...captain, isOnline: true } } })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('disponibilidade: estados independentes', () => {
    const base = { captain: { ...captain, isOnline: true }, internet: true, connected: true, location: { lat: 0, lng: 0, timestamp: 1000 }, now: 2000 }
    it.each([
        [{}, 'available'], [{ internet: false }, 'reconnecting'], [{ connected: false }, 'reconnecting'],
        [{ locationError: 'GPS negado' }, 'gps'], [{ location: { lat: 0, lng: 0 } }, 'gps'],
        [{ now: 62000 }, 'gps'], [{ captain: { ...captain, isOnline: true, canReceiveRides: false } }, 'credits'],
        [{ active: true, internet: false }, 'occupied'], [{ busy: true }, 'accepting'],
        [{ changing: true }, 'changing'], [{ uncertain: true }, 'uncertain'],
        [{ captain, internet: false }, 'offline'], [{ captain: { ...captain, isBlocked: true } }, 'account'],
    ])('deriva %j como %s', (override, key) => expect(driverAvailability({ ...base, ...override }).key).toBe(key))
    it('recusa coordenadas inválidas, futuras ou salvas sem horário', () => {
        for (const location of [null, { lat: 91, lng: 0, timestamp: 1 }, { lat: 0, lng: 181, timestamp: 1 }, { lat: 0, lng: 0 }, { lat: 0, lng: 0, timestamp: 3000 }]) expect(hasRecentLocation(location, 2000)).toBe(false)
    })
    it('conexão caída não muda a escolha online e banner/card concordam', async () => {
        const view = home({ owner: { ...captain, isOnline: true } })
        expect(screen.getByRole('heading', { name: 'Disponível para solicitações' })).toBeInTheDocument()
        act(() => view.ws.emit('disconnect'))
        expect(screen.getByText('Reconectando...')).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Reconectando ao MoveCity' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Ficar offline' })).toBeEnabled()
        act(() => view.ws.emit('connect'))
        expect(screen.getByRole('heading', { name: 'Disponível para solicitações' })).toBeInTheDocument()
        expect(mocks.change).not.toHaveBeenCalled()
        expect(mocks.post).not.toHaveBeenCalled()
    })
    it('offline voluntário continua distinto de falta de internet', async () => {
        home()
        act(() => { fireEvent(window, new Event('offline')) })
        expect(screen.getByRole('heading', { name: 'Você está offline' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Ficar online' })).toBeDisabled()
        expect(mocks.change).not.toHaveBeenCalled()
    })
    it('não mostra botão de disponibilidade durante atendimento ou aceite', () => {
        home({ trip: { _id: 'ride-1', status: 'accepted' } })
        expect(screen.getByRole('heading', { name: 'Atendimento em andamento' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Ficar online/ })).not.toBeInTheDocument()
    })
    it('falha no resumo não vira ganho zero e permite recarregar', async () => {
        mocks.get.mockRejectedValueOnce(new Error('offline'))
        home()
        await waitFor(() => expect(screen.getByText('Ganhos hoje · Indisponível')).toBeInTheDocument())
        fireEvent.click(screen.getByText('Ganhos hoje · Indisponível'))
        fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar resumo' }))
        await waitFor(() => expect(screen.getByText(/Ganhos hoje · R\$/)).toHaveTextContent('42,00'))
    })
})

describe('alteração online: confirmação e concorrência', () => {
    it('bloqueia dois toques antes da permissão e espera ACK', async () => {
        const permission = deferred(), ack = deferred()
        mocks.permission.mockReturnValue(permission.promise)
        mocks.post.mockReturnValue(ack.promise)
        home()
        const button = screen.getByRole('button', { name: 'Ficar online' })
        fireEvent.click(button); fireEvent.click(button)
        expect(mocks.permission).toHaveBeenCalledTimes(1)
        expect(mocks.busy).toHaveBeenLastCalledWith(true)
        expect(mocks.post).not.toHaveBeenCalled()
        await act(async () => permission.resolve({ granted: true }))
        expect(mocks.post).toHaveBeenCalledTimes(1)
        expect(mocks.change).not.toHaveBeenCalled()
        await act(async () => ack.resolve({ data: { captain: { ...captain, isOnline: true } } }))
        expect(screen.getByRole('button', { name: 'Ficar offline' })).toBeInTheDocument()
        expect(mocks.busy).toHaveBeenLastCalledWith(false)
    })
    it.each([{ granted: false }, new Error('Permission failed')])('não envia status se a permissão falhar: %j', async result => {
        if (result instanceof Error) mocks.permission.mockRejectedValue(result)
        else mocks.permission.mockResolvedValue(result)
        home()
        fireEvent.click(screen.getByRole('button', { name: 'Ficar online' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalled())
        expect(mocks.post).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Ficar online' })).toBeEnabled()
    })
    it('repete o mesmo pedido após timeout, sem inverter nem prometer online', async () => {
        mocks.post.mockRejectedValueOnce(Object.assign(new Error('timeout'), { isConnectivityIssue: true }))
        home()
        fireEvent.click(screen.getByRole('button', { name: 'Ficar online' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar disponibilidade' })).toBeEnabled())
        expect(mocks.change).not.toHaveBeenCalled()
        expect(mocks.busy).toHaveBeenLastCalledWith(true)
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar disponibilidade' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Ficar offline' })).toBeEnabled())
        expect(mocks.post.mock.calls.map(call => call[1])).toEqual([{ isOnline: true }, { isOnline: true }])
    })
    it.each([{}, { captain: { ...captain, _id: 'other', isOnline: true } }, { captain: { ...captain, isOnline: false } }])('rejeita ACK incompleto, alheio ou diferente: %j', async data => {
        mocks.post.mockResolvedValue({ data })
        home()
        fireEvent.click(screen.getByRole('button', { name: 'Ficar online' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar disponibilidade' })).toBeEnabled())
        expect(mocks.change).not.toHaveBeenCalled()
        expect(mocks.tracking).not.toHaveBeenCalled()
    })
    it('rejeição explícita preserva último estado e exibe a mensagem do servidor', async () => {
        mocks.post.mockRejectedValue({ response: { status: 403, data: { message: 'Créditos insuficientes' } } })
        home()
        fireEvent.click(screen.getByRole('button', { name: 'Ficar online' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Créditos insuficientes', 'error'))
        expect(screen.getByRole('button', { name: 'Ficar online' })).toBeEnabled()
        expect(mocks.change).not.toHaveBeenCalled()
    })
    it('não aplica resposta atrasada depois de trocar de motorista', async () => {
        const ack = deferred()
        mocks.post.mockReturnValue(ack.promise)
        const view = home()
        fireEvent.click(screen.getByRole('button', { name: 'Ficar online' }))
        await waitFor(() => expect(mocks.post).toHaveBeenCalled())
        view.changeOwner({ ...captain, _id: 'owner-2' })
        await act(async () => ack.resolve({ data: { captain: { ...captain, isOnline: true } } }))
        expect(mocks.change).not.toHaveBeenCalled()
        expect(mocks.tracking).not.toHaveBeenCalled()
    })
    it('não envia após desmontagem durante permissão', async () => {
        const permission = deferred()
        mocks.permission.mockReturnValue(permission.promise)
        const view = home()
        fireEvent.click(screen.getByRole('button', { name: 'Ficar online' }))
        view.unmount()
        await act(async () => permission.resolve({ granted: true }))
        expect(mocks.post).not.toHaveBeenCalled()
    })
    it('preserva rastreamento de serviço que chegou enquanto desligava', async () => {
        const ack = deferred()
        mocks.post.mockReturnValue(ack.promise)
        const view = home({ owner: { ...captain, isOnline: true } })
        fireEvent.click(screen.getByRole('button', { name: 'Ficar offline' }))
        view.changeTrip({ _id: 'ride-1', status: 'started' })
        await act(async () => ack.resolve({ data: { captain } }))
        expect(mocks.permission).not.toHaveBeenCalled()
        expect(mocks.tracking).toHaveBeenCalledWith({ isOnline: false, hasActiveTrip: true, serviceKind: 'ride' })
    })
})
