import { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CaptainLogout from '@/driver/pages/CaptainLogout'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { queryClient } from '@/shared/services/queryClient'
import { saveSession, getAccessToken } from '@/shared/services/session'

const mocks = vi.hoisted(() => ({ post: vi.fn(), unregister: vi.fn(), stop: vi.fn(), clearSW: vi.fn(), setCaptain: vi.fn(),
    socket: { connect: vi.fn(), disconnect: vi.fn() } }))
vi.mock('@/shared/services/axios', () => ({ default: { post: mocks.post } }))
vi.mock('@/shared/services/swCommunication', () => ({ clearTokenInSW: mocks.clearSW }))
vi.mock('@/shared/platform/notification.service', () => ({ unregisterPush: mocks.unregister }))
vi.mock('@/shared/platform/location.service', () => ({ stopForegroundTracking: mocks.stop }))
vi.mock('@/shared/platform/nativeSession.service', () => ({ clearNativeCaptainSession: vi.fn(), syncNativeCaptainSession: vi.fn() }))
vi.mock('@/shared/contexts/SocketContext', async () => ({ SocketContext: (await import('react')).createContext({}) }))

function mount() {
    return render(<StrictMode><MemoryRouter initialEntries={['/captain/logout']}>
        <CaptainDataContext.Provider value={{ setCaptain: mocks.setCaptain }}>
            <SocketContext.Provider value={{ socket: mocks.socket }}>
                <Routes>
                    <Route path="/captain/logout" element={<CaptainLogout />} />
                    <Route path="/captain-login" element={<p>Entrada do motorista</p>} />
                </Routes>
            </SocketContext.Provider>
        </CaptainDataContext.Provider>
    </MemoryRouter></StrictMode>)
}

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    saveSession('captain', { token: 'old-token', refreshToken: 'old-refresh' }, { syncNative: false })
    mocks.post.mockResolvedValue({ status: 200 })
    mocks.unregister.mockResolvedValue(undefined)
    mocks.stop.mockResolvedValue(undefined)
    mocks.clearSW.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); queryClient.clear(); localStorage.clear(); vi.useRealTimers() })

describe('saída do motorista independente da rede', () => {
    it('limpa credenciais e carteira imediatamente, uma única vez em StrictMode', async () => {
        queryClient.setQueryData(['captainWallet', 'c1'], { creditBalance: 35 })
        mount()
        expect(getAccessToken('captain')).toBeNull()
        expect(queryClient.getQueryData(['captainWallet', 'c1'])).toBeUndefined()
        expect(mocks.setCaptain).toHaveBeenCalledWith(null)
        expect(mocks.post).toHaveBeenCalledOnce()
        expect(mocks.post).toHaveBeenCalledWith('/captains/logout', { refreshToken: 'old-refresh' }, expect.objectContaining({
            headers: { Authorization: 'Bearer old-token' }, _skipSessionRecovery: true,
        }))
        await screen.findByText('Entrada do motorista')
        expect(mocks.socket.disconnect).toHaveBeenCalledOnce()
    })

    it.each(['post', 'unregister', 'stop', 'clearSW'])('operação %s pendurada libera a saída em cinco segundos', async operation => {
        mocks[operation].mockImplementation(() => new Promise(() => {}))
        vi.useFakeTimers()
        mount()
        await act(() => vi.advanceTimersByTimeAsync(5000))
        expect(screen.getByText('Entrada do motorista')).toBeInTheDocument()
        expect(getAccessToken('captain')).toBeNull()
        expect(mocks.post.mock.calls[0][2].signal.aborted).toBe(true)
    })

    it('um login posterior sobrevive à conclusão atrasada do logout', async () => {
        let finish
        mocks.post.mockImplementation(() => new Promise(resolve => { finish = resolve }))
        const view = mount()
        view.unmount()
        saveSession('captain', { token: 'new-token', refreshToken: 'new-refresh' }, { syncNative: false })
        await act(async () => { finish({ status: 200 }) })
        expect(getAccessToken('captain')).toBe('new-token')
        expect(mocks.clearSW.mock.calls[0][0].shouldClear()).toBe(false)
        expect(mocks.socket.connect).not.toHaveBeenCalled()
    })
})
