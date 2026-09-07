import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/shared/services/db'
import { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import CaptainRiding from '@/driver/pages/CaptainRiding'

const state = vi.hoisted(() => ({ meter: vi.fn(() => null), notify: vi.fn(), toast: vi.fn() }))
vi.mock('@/shared/hooks/useRideMeter', () => ({ useRideMeter: state.meter }))
vi.mock('@/shared/hooks/useWakeLock', () => ({ useWakeLock: () => ({ requestLock: () => {} }) }))
vi.mock('@/shared/services/browserNotify', () => ({ showBrowserNotification: state.notify }))
vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: state.toast }) }))
vi.mock('@/shared/components/LiveTracking', () => ({ default: () => <div>Mapa</div> }))
vi.mock('@/shared/components/RideChat', () => ({ default: () => null }))
vi.mock('@/driver/components/FinishRide', () => ({ default: () => null }))
vi.mock('@/shared/components/ui/ConnectionBanner', () => ({ default: () => null }))
const ride = { _id: 'r1', status: 'started', source: 'driver_initiated', destinationPending: true,
    pickup: 'Rua A', startedAt: new Date(Date.now() - 180000).toISOString() }
const socket = { connected: false, on: vi.fn(), off: vi.fn() }
function mount(syncCaptainRide = vi.fn(async () => undefined)) {
    render(<MemoryRouter initialEntries={[{ pathname: '/captain-riding', state: { ride } }]}>
        <CaptainDataContext.Provider value={{ captain: { _id: 'cap1' } }}>
            <SocketContext.Provider value={{ socket }}>
                <RideContext.Provider value={{ captainRide: null, setCaptainRide: vi.fn(), syncCaptainRide }}>
                    <Routes>
                        <Route path="/captain-riding" element={<CaptainRiding />} />
                        <Route path="/captain/rides" element={<p>Histórico de pendências</p>} />
                        <Route path="/captain-home" element={<p>Início</p>} />
                    </Routes>
                </RideContext.Provider>
            </SocketContext.Provider>
        </CaptainDataContext.Provider>
    </MemoryRouter>)
    return syncCaptainRide
}
beforeEach(async () => { await db.delete(); await db.open(); vi.clearAllMocks() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await db.delete() })

describe('navegação antiga não ressuscita corrida finalizada offline', () => {
    it('desvia para pendências antes de iniciar contador, GPS ou aviso de nova corrida', async () => {
        await db.offlineActions.add({ type: 'end-ride', rideId: 'r1', timestamp: Date.now() })
        const sync = mount()
        expect(await screen.findByText('Histórico de pendências')).toBeInTheDocument()
        expect(sync).not.toHaveBeenCalled()
        expect(state.meter.mock.calls.every(([candidate]) => candidate === null)).toBe(true)
        expect(state.notify).not.toHaveBeenCalled()
    })
    it('erro ao ler pendência não autoriza abrir o snapshot antigo', async () => {
        vi.spyOn(db.offlineActions, 'toArray').mockRejectedValueOnce(new Error('Armazenamento indisponível'))
        mount()
        expect(await screen.findByText('Histórico de pendências')).toBeInTheDocument()
        expect(state.meter.mock.calls.every(([candidate]) => candidate === null)).toBe(true)
    })
    it('sem pendência, o contador local não fica esperando resposta da rede', async () => {
        mount(() => new Promise(() => {}))
        await waitFor(() => expect(state.meter.mock.calls.some(([candidate]) => candidate?._id === 'r1')).toBe(true))
        expect(screen.queryByText('Histórico de pendências')).toBeNull()
    })
})
