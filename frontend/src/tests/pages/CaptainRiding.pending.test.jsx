import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/shared/services/db'
import { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import CaptainRiding from '@/driver/pages/CaptainRiding'

const state = vi.hoisted(() => ({ meter: vi.fn(() => null), notify: vi.fn(), toast: vi.fn(), finishProps: null, post: vi.fn() }))
vi.mock('@/shared/hooks/useRideMeter', () => ({ useRideMeter: state.meter }))
vi.mock('@/shared/hooks/useWakeLock', () => ({ useWakeLock: () => ({ requestLock: () => {} }) }))
vi.mock('@/shared/services/browserNotify', () => ({ showBrowserNotification: state.notify }))
vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn(), post: state.post } }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: state.toast }) }))
vi.mock('@/shared/components/LiveTracking', () => ({ default: () => <div>Mapa</div> }))
vi.mock('@/shared/components/RideChat', () => ({ default: () => null }))
vi.mock('@/driver/components/FinishRide', () => ({ default: props => { state.finishProps = props; return <p>Conteúdo da finalização</p> } }))
vi.mock('@/shared/components/ui/ConnectionBanner', () => ({ default: () => null }))
const ride = { _id: 'r1', status: 'started', source: 'driver_initiated', destinationPending: true,
    pickup: 'Rua A', startedAt: new Date(Date.now() - 180000).toISOString() }
const socket = { connected: false, on: vi.fn(), off: vi.fn() }
function mount(syncCaptainRide = vi.fn(async () => undefined), initialRide = ride) {
    render(<MemoryRouter initialEntries={[{ pathname: '/captain-riding', state: { ride: initialRide } }]}>
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
    it('ajuda mantém a corrida e não envia ações de cobrança ou cancelamento', async () => {
        mount()
        fireEvent.click(await screen.findByRole('button', { name: 'Ajuda e segurança' }))
        expect(screen.getAllByRole('dialog')).toHaveLength(1)
        expect(screen.getByRole('dialog')).toHaveAccessibleName('Ajuda e segurança')
        expect(screen.getByRole('link', { name: 'Polícia · 190' })).toHaveAttribute('href', 'tel:190')
        expect(screen.getByRole('textbox', { name: 'Contexto para o suporte' }).value).toContain('Corrida: r1')
        expect(state.post).not.toHaveBeenCalled()
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(screen.getByRole('button', { name: 'Finalizar corrida' })).toBeEnabled()
    })
    it('finalização em andamento bloqueia fechar e não abre um segundo painel', async () => {
        mount()
        fireEvent.click(await screen.findByRole('button', { name: 'Finalizar corrida' }))
        act(() => state.finishProps.onBusyChange(true))
        expect(screen.getByRole('button', { name: 'Voltar à corrida' })).toBeDisabled()
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.getAllByRole('dialog')).toHaveLength(1)
        expect(document.querySelector('[data-driver-trip]').inert).toBe(true)
        act(() => state.finishProps.onBusyChange(false))
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByRole('dialog')).toBeNull()
    })
    it('recibo encerrado para o contador e ao fechar vai ao histórico, sem reativar', async () => {
        mount()
        fireEvent.click(await screen.findByRole('button', { name: 'Finalizar corrida' }))
        act(() => state.finishProps.onFinishedChange(true))
        expect(state.meter.mock.calls.at(-1)[0]).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Abrir histórico de corridas' }))
        expect(await screen.findByText('Histórico de pendências')).toBeInTheDocument()
    })
    it('resposta tardia da restauração não descarta o recibo já encerrado', async () => {
        let resolve
        mount(() => new Promise(done => { resolve = done }))
        fireEvent.click(await screen.findByRole('button', { name: 'Finalizar corrida' }))
        act(() => state.finishProps.onFinishedChange(true))
        await act(async () => resolve(null))
        expect(screen.getByRole('dialog', { name: 'Finalização da corrida' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Abrir histórico de corridas' })).toBeInTheDocument()
    })
    it('corrida antiga não oferece cancelamento por engano ao expandir detalhes', async () => {
        mount()
        fireEvent.click(await screen.findByRole('button', { name: 'Ver detalhes da corrida e do sinal' }))
        expect(screen.queryByRole('button', { name: 'Cancelar corrida iniciada por engano' })).toBeNull()
    })
    it.each([null, {}, { status: 'started' }])('não libera corrida vazia após resposta desconhecida (%j)', async initialRide => {
        mount(vi.fn(async () => undefined), initialRide)
        expect(await screen.findByText('Não foi possível recuperar a corrida')).toBeInTheDocument()
        expect(screen.queryByText('Mapa')).toBeNull()
        expect(screen.queryByRole('button', { name: /finalizar|concluir/i })).toBeNull()
        expect(state.meter.mock.calls.every(([candidate]) => candidate === null)).toBe(true)
        expect(state.notify).not.toHaveBeenCalled()
    })
    it('permite tentar recuperar novamente sem inventar ausência de corrida', async () => {
        const sync = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(ride)
        mount(sync, null)
        fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }))
        expect(await screen.findByText('Mapa')).toBeInTheDocument()
        expect(sync).toHaveBeenCalledTimes(2)
        expect(state.toast).not.toHaveBeenCalledWith('Nenhuma corrida em andamento encontrada.', 'info')
    })
    it('recuperação encontra pendência e abre o histórico sem reativar controles', async () => {
        await db.offlineActions.add({ type: 'end-ride', rideId: 'r1', timestamp: Date.now() })
        mount(vi.fn(async () => ride), null)
        expect(await screen.findByText('Histórico de pendências')).toBeInTheDocument()
        expect(state.meter.mock.calls.every(([candidate]) => candidate === null)).toBe(true)
    })
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
