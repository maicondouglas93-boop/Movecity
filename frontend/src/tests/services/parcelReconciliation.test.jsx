import 'fake-indexeddb/auto'
import { useContext } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RideProvider, { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { saveSession } from '@/shared/services/session'
import api from '@/shared/services/axios'

vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@/shared/platform/appLifecycle.service', () => ({ onAppActive: () => () => {} }))
vi.mock('@/shared/services/driverRecoveryStore', () => ({ loadDriverRecovery: async () => null, saveDriverRide: vi.fn() }))
const login = id => saveSession('captain', { token: `header.${btoa(JSON.stringify({ _id: id, actorType: 'captain' }))}.sig` }, { syncNative: false })
const parcel = { _id: 'p1', status: 'provider_accepted' }
let context
function Probe() {
    context = useContext(RideContext)
    return <p data-testid="parcel">{context.captainParcel ? `${context.captainParcel._id}:${context.captainParcel.status}:${context.captainParcel.paymentStatus}` : 'none'}</p>
}
function mount() {
    const socket = { on: vi.fn(), off: vi.fn() }
    return render(<SocketContext.Provider value={{ socket }}><MemoryRouter initialEntries={['/captain-parcel']}><RideProvider><Probe /></RideProvider></MemoryRouter></SocketContext.Provider>)
}
beforeEach(() => { localStorage.clear(); login('c1'); api.get.mockReset().mockImplementation(async url => ({ data: url === '/parcels/captain-current' ? parcel : null })) })
afterEach(cleanup)
describe('Reconciliação compartilhada de encomendas', () => {
    it('tela e reconexão compartilham a mesma consulta sem resultado desconhecido artificial', async () => {
        mount(); await screen.findByText('p1:provider_accepted:undefined')
        let resolve
        api.get.mockClear().mockReturnValue(new Promise(r => { resolve = r }))
        const first = context.syncCaptainParcel()
        const second = context.syncCaptainParcel()
        expect(first).toBe(second)
        expect(api.get).toHaveBeenCalledTimes(1)
        await act(async () => resolve({ data: parcel }))
        expect(await first).toEqual(parcel)
        expect(await second).toEqual(parcel)
    })
    it('consulta antiga não apaga um ACK recebido enquanto ela estava em trânsito', async () => {
        mount(); await screen.findByText('p1:provider_accepted:undefined')
        let resolve
        api.get.mockReturnValue(new Promise(r => { resolve = r }))
        let pending
        act(() => { pending = context.syncCaptainParcel() })
        act(() => context.setCaptainParcel({ ...parcel, status: 'going_to_pickup' }))
        await act(async () => resolve({ data: null }))
        expect(await pending).toBeUndefined()
        expect(screen.getByTestId('parcel')).toHaveTextContent('going_to_pickup')
    })
    it('respostas antigas não fazem status e liquidação retrocederem', async () => {
        mount(); await screen.findByText('p1:provider_accepted:undefined')
        act(() => context.setCaptainParcel({ ...parcel, status: 'finished', paymentStatus: 'paid' }))
        api.get.mockResolvedValue({ data: { ...parcel, status: 'finished', paymentStatus: 'pending' } })
        await act(async () => context.syncCaptainParcel())
        expect(screen.getByTestId('parcel')).toHaveTextContent('finished:paid')
        act(() => context.setCaptainParcel(parcel))
        expect(screen.getByTestId('parcel')).toHaveTextContent('finished:paid')
    })
    it('callback e resposta da conta anterior não atravessam a troca de conta', async () => {
        mount(); await screen.findByText('p1:provider_accepted:undefined')
        const oldSetter = context.setCaptainParcel
        let resolve
        api.get.mockReturnValueOnce(new Promise(r => { resolve = r })).mockResolvedValue({ data: null })
        let pending
        act(() => { pending = context.syncCaptainParcel() })
        act(() => login('c2'))
        await waitFor(() => expect(context.captainParcelOwnerId).toBe('c2'))
        act(() => oldSetter(parcel))
        await act(async () => resolve({ data: parcel }))
        expect(await pending).toBeUndefined()
        expect(screen.getByTestId('parcel')).toHaveTextContent('none')
    })
    it.each([{}, false, undefined])('200 malformado %j não apaga a encomenda', async data => {
        mount(); await screen.findByText('p1:provider_accepted:undefined')
        api.get.mockResolvedValue({ data })
        let result
        await act(async () => { result = await context.syncCaptainParcel() })
        expect(result).toBeUndefined()
        expect(screen.getByTestId('parcel')).toHaveTextContent('p1:provider_accepted')
    })
})
