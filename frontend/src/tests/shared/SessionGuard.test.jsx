import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UserProtectWrapper from '@/passenger/pages/UserProtectWrapper'
import CaptainProtectWrapper from '@/driver/pages/CaptainProtectWrapper'
import { UserDataContext } from '@/passenger/contexts/UserContext'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import api from '@/shared/services/axios'
import { onAppActive } from '@/shared/platform/appLifecycle.service'

vi.mock('@/shared/services/axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@/shared/platform/appLifecycle.service', () => ({ onAppActive: vi.fn(() => vi.fn()) }))

const advance = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const failure = (status) => Object.assign(new Error('request failed'), status ? { response: { status } } : {})

function renderGuard(kind = 'user') {
    const setProfile = vi.fn()
    const Wrapper = kind === 'user' ? UserProtectWrapper : CaptainProtectWrapper
    const Context = kind === 'user' ? UserDataContext : CaptainDataContext
    const view = render(
        <Context.Provider value={{ setUser: setProfile, setCaptain: setProfile }}>
            <MemoryRouter initialEntries={['/home']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Routes>
                    <Route path="/login" element={<p>Login passageiro</p>} />
                    <Route path="/captain-login" element={<p>Login motorista</p>} />
                    <Route path="/*" element={<Wrapper><p>Área protegida</p><Link to="/wallet">Carteira</Link></Wrapper>} />
                </Routes>
            </MemoryRouter>
        </Context.Provider>,
    )
    return { ...view, setProfile }
}

describe('recuperação da sessão na entrada', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        api.get.mockReset()
        onAppActive.mockClear()
        localStorage.clear()
        localStorage.setItem('token', 'user-token')
        localStorage.setItem('captain-token', 'captain-token')
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    })
    afterEach(() => {
        cleanup()
        vi.clearAllTimers()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it.each(['user', 'captain'])('recupera %s automaticamente depois de timeout, sem expor a tela antes', async (kind) => {
        const profile = { _id: kind }
        api.get.mockRejectedValueOnce(failure()).mockResolvedValue({ data: kind === 'user' ? profile : { captain: profile } })
        const { setProfile } = renderGuard(kind)
        await advance()
        expect(screen.queryByText('Área protegida')).not.toBeInTheDocument()
        expect(screen.getByText('Conectando ao servidor...')).toBeInTheDocument()
        await advance(2000)
        expect(screen.getByText('Área protegida')).toBeInTheDocument()
        expect(setProfile).toHaveBeenCalledWith(profile)
        expect(api.get).toHaveBeenLastCalledWith(kind === 'user' ? '/users/profile' : '/captains/profile', { signal: expect.any(AbortSignal) })
        await advance(120000)
        expect(api.get).toHaveBeenCalledTimes(2)
    })

    it('não trava se o transporte nativo nunca responder', async () => {
        api.get.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue({ data: { _id: 'user' } })
        renderGuard()
        await advance(1500)
        expect(screen.getByText('Conectando ao servidor...')).toBeInTheDocument()
        expect(screen.getByRole('button')).toBeDisabled()
        await advance(10500)
        expect(api.get.mock.calls[0][1].signal.aborted).toBe(true)
        await advance(2000)
        expect(screen.getByText('Área protegida')).toBeInTheDocument()
    })

    it('tolera mais de um minuto de indisponibilidade com backoff e preserva o login', async () => {
        api.get.mockRejectedValue(failure(503))
        renderGuard()
        await advance(61000)
        expect(screen.getByText('O servidor está demorando para responder')).toBeInTheDocument()
        expect(localStorage.getItem('token')).toBe('user-token')
        expect(api.get.mock.calls.length).toBeLessThanOrEqual(7)
        api.get.mockResolvedValue({ data: { _id: 'user' } })
        await advance(15000)
        expect(screen.getByText('Área protegida')).toBeInTheDocument()
    })

    it('aguarda a internet e recupera no evento online', async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
        api.get.mockResolvedValue({ data: {} })
        renderGuard()
        await advance(60000)
        expect(api.get).not.toHaveBeenCalled()
        expect(screen.getByText('Você está sem internet')).toBeInTheDocument()
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
        fireEvent(window, new Event('online'))
        await advance()
        expect(screen.getByText('Área protegida')).toBeInTheDocument()
    })

    it('pausa tentativas em segundo plano e retoma ao voltar ao app', async () => {
        api.get.mockRejectedValueOnce(failure()).mockResolvedValue({ data: {} })
        renderGuard()
        await advance()
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        await advance(60000)
        expect(api.get).toHaveBeenCalledTimes(1)
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
        act(() => onAppActive.mock.calls[0][0]())
        await advance()
        expect(screen.getByText('Área protegida')).toBeInTheDocument()
    })

    it('retry manual/eventos concorrentes não duplicam a requisição em andamento', async () => {
        let resolve
        api.get.mockRejectedValueOnce(failure()).mockImplementationOnce(() => new Promise(r => { resolve = r }))
        renderGuard()
        await advance()
        fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
        fireEvent(window, new Event('online'))
        fireEvent(window, new Event('focus'))
        act(() => onAppActive.mock.calls[0][0]())
        await advance(2000)
        expect(api.get).toHaveBeenCalledTimes(2)
        await act(async () => resolve({ data: {} }))
        await advance(60000)
        expect(api.get).toHaveBeenCalledTimes(2)
    })

    it.each(['user', 'captain'])('sem sessão de %s redireciona sem buscar perfil', async (kind) => {
        localStorage.removeItem(kind === 'user' ? 'token' : 'captain-token')
        renderGuard(kind)
        await advance()
        expect(screen.getByText(kind === 'user' ? 'Login passageiro' : 'Login motorista')).toBeInTheDocument()
        expect(api.get).not.toHaveBeenCalled()
    })

    it('tenta recuperar quando só resta refresh token', async () => {
        localStorage.removeItem('token')
        localStorage.setItem('refreshToken', 'refresh')
        api.get.mockResolvedValue({ data: {} })
        renderGuard()
        await advance()
        expect(screen.getByText('Área protegida')).toBeInTheDocument()
    })

    it('401 definitivo redireciona ao login, sem loop de tentativas', async () => {
        api.get.mockRejectedValue(failure(401))
        renderGuard()
        await advance(60000)
        expect(screen.getByText('Login passageiro')).toBeInTheDocument()
        expect(api.get).toHaveBeenCalledTimes(1)
    })

    it.each([403, 404])('não confunde HTTP %s com internet caída nem deixa spinner infinito', async (code) => {
        api.get.mockRejectedValue(failure(code))
        renderGuard()
        await advance(60000)
        expect(screen.getByText(code === 403 ? 'Não foi possível autorizar seu acesso' : 'Não foi possível carregar sua conta')).toBeInTheDocument()
        expect(screen.queryByText('Área protegida')).not.toBeInTheDocument()
        expect(api.get).toHaveBeenCalledTimes(1)
    })

    it('ignora resposta tardia e remove listeners quando desmonta', async () => {
        let resolve
        api.get.mockImplementation(() => new Promise(r => { resolve = r }))
        const { unmount, setProfile } = renderGuard()
        const stop = onAppActive.mock.results[0].value
        unmount()
        expect(api.get.mock.calls[0][1].signal.aborted).toBe(true)
        expect(stop).toHaveBeenCalledOnce()
        await act(async () => resolve({ data: {} }))
        fireEvent(window, new Event('online'))
        await advance(60000)
        expect(setProfile).not.toHaveBeenCalled()
        expect(api.get).toHaveBeenCalledTimes(1)
    })

    it('não reinicia a validação ao navegar entre rotas já protegidas', async () => {
        api.get.mockResolvedValue({ data: {} })
        renderGuard()
        await advance()
        fireEvent.click(screen.getByRole('link', { name: 'Carteira' }))
        await advance(60000)
        expect(screen.getByText('Área protegida')).toBeInTheDocument()
        expect(api.get).toHaveBeenCalledTimes(1)
    })
})
