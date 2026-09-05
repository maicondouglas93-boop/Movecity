import 'fake-indexeddb/auto'
import { useContext } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CaptainProtectWrapper from '@/driver/pages/CaptainProtectWrapper'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import RideProvider, { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { db } from '@/shared/services/db'
import { saveSession, clearSession } from '@/shared/services/session'
import { loadDriverRecovery, readDriverRecovery, saveDriverProfile, saveDriverRide } from '@/shared/services/driverRecoveryStore'
import { enqueueOfflineAction } from '@/shared/services/offlineQueue'
import api from '@/shared/services/axios'

vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@/shared/platform/appLifecycle.service', () => ({ onAppActive: () => () => {} }))
vi.mock('@/shared/platform/nativeSession.service', () => ({ clearNativeCaptainSession: vi.fn() }))
const token = id => `header.${btoa(JSON.stringify({ _id: id, actorType: 'captain', exp: 1 }))}.signature`
const ride = { _id: 'trip', status: 'started', startedAt: new Date(Date.now() - 600000).toISOString(),
    fareRates: { baseFare: 5, perKm: 2, perMinute: 1 }, actualDistance: 1000 }
const profile = { _id: 'cap1', fullname: { firstname: 'Motorista' } }
const login = id => saveSession('captain', { token: token(id), refreshToken: 'refresh' }, { syncNative: false })
let lastSetRide

function ActiveTrip() {
    const { captainRide, setCaptainRide } = useContext(RideContext)
    lastSetRide = setCaptainRide
    return <><p>{captainRide?.status === 'started' ? `Corrida ${captainRide._id}` : 'Sem corrida local'}</p>
        <button onClick={() => setCaptainRide({ ...ride, status: 'finished' })}>Encerrar local</button>
        <Link to="/captain-home">Voltar</Link></>
}
function Location() { return <p data-testid="route">{useLocation().pathname}</p> }
function mount(path = '/captain-home') {
    const setCaptain = vi.fn()
    const socket = { connected: false, on: vi.fn(), off: vi.fn() }
    return { setCaptain, ...render(<CaptainDataContext.Provider value={{ setCaptain }}>
        <SocketContext.Provider value={{ socket }}><MemoryRouter initialEntries={[path]}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <RideProvider><Location /><Routes>
                <Route path="/captain-login" element={<p>Login motorista</p>} />
                <Route path="*" element={<CaptainProtectWrapper><ActiveTrip /></CaptainProtectWrapper>} />
            </Routes></RideProvider>
        </MemoryRouter></SocketContext.Provider>
    </CaptainDataContext.Provider>) }
}

describe('reabrir corrida sem sinal', () => {
    beforeEach(async () => {
        localStorage.clear(); await db.delete(); await db.open()
        login('cap1'); saveDriverProfile('cap1', profile); saveDriverRide('cap1', ride)
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
        api.get.mockReset().mockRejectedValue(new Error('Network Error'))
    })
    afterEach(async () => { cleanup(); vi.restoreAllMocks(); await db.delete() })

    it('restaura perfil e corrida com token expirado, sem pedir internet', async () => {
        const { setCaptain } = mount()
        expect(await screen.findByText('Corrida trip')).toBeInTheDocument()
        expect(screen.getByTestId('route')).toHaveTextContent('/captain-riding')
        expect(setCaptain).toHaveBeenCalledWith(profile)
        expect(api.get).not.toHaveBeenCalled()
        expect(screen.getByText(/Corrida recuperada no aparelho/)).toBeInTheDocument()
    })
    it('reabertura na carteira limita acesso à corrida salva', async () => {
        mount('/captain-wallet')
        await screen.findByText('Corrida trip')
        expect(screen.getByTestId('route')).toHaveTextContent('/captain-riding')
    })
    it('503 com navegador online também recupera e preserva a corrida', async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
        api.get.mockRejectedValue({ response: { status: 503 } })
        mount()
        await screen.findByText('Corrida trip')
        expect(readDriverRecovery('cap1').ride._id).toBe('trip')
    })
    it('reconecta e revalida o perfil sem desmontar a corrida', async () => {
        mount(); await screen.findByText('Corrida trip')
        api.get.mockImplementation(async path => ({ data: path.includes('profile') ? { captain: profile }
            : path.includes('captain-current') && path.includes('rides') ? ride : null }))
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
        fireEvent(window, new Event('online'))
        await waitFor(() => expect(screen.queryByText(/Corrida recuperada no aparelho/)).not.toBeInTheDocument())
        expect(screen.getByText('Corrida trip')).toBeInTheDocument()
    })
    it.each([401, 403])('HTTP %s definitivo remove recuperação e impede reutilização', async status => {
        mount(); await screen.findByText('Corrida trip')
        api.get.mockRejectedValue({ response: { status } })
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
        fireEvent(window, new Event('online'))
        await screen.findByText(status === 401 ? 'Login motorista' : 'Não foi possível autorizar seu acesso')
        expect(readDriverRecovery('cap1')).toBeNull()
        expect(screen.queryByText('Corrida trip')).not.toBeInTheDocument()
    })
    it('outra conta e logout explícito não recuperam a corrida anterior', async () => {
        login('cap2'); expect(await loadDriverRecovery('cap2')).toBeNull()
        login('cap1'); mount(); await screen.findByText('Corrida trip')
        act(() => clearSession('captain'))
        await screen.findByText('Login motorista')
        expect(readDriverRecovery('cap1')).toBeNull()
    })
    it('fim pendente impede restore se o app morreu antes de apagar o snapshot', async () => {
        await db.offlineActions.add({ type: 'end-ride', rideId: 'trip', timestamp: Date.now() })
        expect(await loadDriverRecovery('cap1')).toBeNull()
        mount(); await screen.findByText('Você está sem internet')
        expect(screen.queryByText('Corrida trip')).not.toBeInTheDocument()
    })
    it('enfileirar fim remove o snapshot e mantém o trabalho para sincronizar', async () => {
        await enqueueOfflineAction({ type: 'end-ride', rideId: 'trip', payload: { rideId: 'trip', finishTimestamp: Date.now() } })
        expect(readDriverRecovery('cap1').ride).toBeNull()
        expect(await db.offlineActions.count()).toBe(1)
    })
    it('encerrar localmente persiste remoção e não reaparece após remontagem', async () => {
        const view = mount(); await screen.findByText('Corrida trip')
        fireEvent.click(screen.getByRole('button', { name: 'Encerrar local' }))
        expect(readDriverRecovery('cap1').ride).toBeNull()
        view.unmount(); mount(); await screen.findByText('Você está sem internet')
        expect(screen.queryByText('Corrida trip')).not.toBeInTheDocument()
    })
    it('snapshot corrompido ou de outro servidor não autoriza recuperação', async () => {
        const key = 'movecity:driver-recovery:v1'
        localStorage.setItem(key, '{corrompido')
        expect(await loadDriverRecovery('cap1')).toBeNull()
        saveDriverProfile('cap1', profile); saveDriverRide('cap1', ride)
        localStorage.setItem(key, JSON.stringify({ ...readDriverRecovery('cap1'), apiBase: 'https://wrong.example' }))
        expect(await loadDriverRecovery('cap1')).toBeNull()
    })
    it('sair após finalizar offline não redireciona de volta à corrida encerrada', async () => {
        mount(); await screen.findByText('Corrida trip')
        fireEvent.click(screen.getByRole('button', { name: 'Encerrar local' }))
        fireEvent.click(screen.getByText('Voltar'))
        await screen.findByText('Você está sem internet')
        expect(screen.getByTestId('route')).toHaveTextContent('/captain-home')
        expect(screen.queryByText('Corrida trip')).not.toBeInTheDocument()
    })
    it('404 confirmado ao reconectar remove corrida salva; falha de rede não faz isso', async () => {
        mount(); await screen.findByText('Corrida trip')
        api.get.mockImplementation(async path => {
            if (path.includes('profile')) return { data: { captain: profile } }
            throw { response: { status: 404 } }
        })
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
        fireEvent(window, new Event('online'))
        await screen.findByText('Sem corrida local')
        expect(readDriverRecovery('cap1').ride).toBeNull()
    })
    it('callback antigo não grava a corrida na conta de outro motorista', async () => {
        mount(); await screen.findByText('Corrida trip')
        const oldCallback = lastSetRide
        act(() => login('cap2'))
        act(() => oldCallback(ride))
        expect(readDriverRecovery('cap2')).toBeNull()
        expect(screen.queryByText('Corrida trip')).not.toBeInTheDocument()
    })
})
