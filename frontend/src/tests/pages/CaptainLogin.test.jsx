import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import CaptainLogin from '@/driver/pages/CaptainLogin'

const mocks = vi.hoisted(() => ({ login: vi.fn(), save: vi.fn(), captain: vi.fn(), toast: vi.fn(), sync: vi.fn() }))
vi.mock('@/shared/services/loginReadiness', () => ({ loginCaptainReliably: mocks.login }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: () => null, saveSession: mocks.save }))
vi.mock('@/shared/services/swCommunication', () => ({ syncTokenWithSW: mocks.sync }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }))
vi.mock('@/shared/platform/platform', () => ({ getAppRole: () => 'driver' }))
const ack = { status: 200, data: { token: 'fake-session-token', captain: { _id: 'c1', fullname: { firstname: 'Teste' }, isOnline: false } } }
function mount() {
    return render(<MemoryRouter initialEntries={['/captain-login']}><CaptainDataContext.Provider value={{ setCaptain: mocks.captain }}>
        <Routes><Route path="/captain-login" element={<CaptainLogin />} /><Route path="/captain-home" element={<p>Início do motorista</p>} />
            <Route path="/captain-help" element={<p>Ajuda sem autenticação</p>} /></Routes>
    </CaptainDataContext.Provider></MemoryRouter>)
}
function fill() {
    fireEvent.change(screen.getByLabelText('Qual é o seu email?'), { target: { value: 'MOTORISTA@EXEMPLO.COM' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: ' senha com espaços ' } })
}
beforeEach(() => { vi.clearAllMocks(); mocks.login.mockResolvedValue(ack) })
afterEach(cleanup)
describe('login motorista: recuperação acessível e confirmação de sessão', () => {
    it('mostra e oculta senha sem mudar conteúdo nem enviar formulário', () => {
        mount(); fill()
        fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }))
        expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'text')
        expect(screen.getByLabelText('Senha')).toHaveValue(' senha com espaços ')
        fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }))
        expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'password')
        expect(mocks.login).not.toHaveBeenCalled()
    })
    it('ajuda de acesso é pública, não carrega senha na URL e não cria sessão', async () => {
        mount(); fill()
        const help = screen.getByRole('link', { name: 'Esqueci a senha / preciso de ajuda' })
        expect(help).toHaveAttribute('href', '/captain-help?category=access')
        fireEvent.click(help)
        expect(await screen.findByText('Ajuda sem autenticação')).toBeInTheDocument()
        expect(mocks.save).not.toHaveBeenCalled()
    })
    it('normaliza somente e-mail; login confirmado não anuncia disponibilidade online', async () => {
        mount(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
        await screen.findByText('Início do motorista')
        expect(mocks.login).toHaveBeenCalledWith({ email: 'motorista@exemplo.com', password: ' senha com espaços ' }, expect.any(Object))
        expect(mocks.save).toHaveBeenCalledWith('captain', ack.data)
        expect(mocks.captain).toHaveBeenCalledWith(ack.data.captain)
        expect(mocks.toast).toHaveBeenCalledWith('Bem-vindo, Teste!', 'success')
    })
    it('lê autofill do DOM mesmo sem evento React', async () => {
        mount()
        screen.getByLabelText('Qual é o seu email?').value = 'autofill@exemplo.com'
        screen.getByLabelText('Senha').value = 'secret123'
        fireEvent.submit(screen.getByRole('button', { name: 'Entrar' }).closest('form'))
        await screen.findByText('Início do motorista')
        expect(mocks.login).toHaveBeenCalledWith({ email: 'autofill@exemplo.com', password: 'secret123' }, expect.any(Object))
    })
    it('clique duplo/submit repetido envia uma tentativa só', async () => {
        let resolve
        mocks.login.mockImplementation(() => new Promise(done => { resolve = done }))
        mount(); fill()
        const form = screen.getByRole('button', { name: 'Entrar' }).closest('form')
        fireEvent.submit(form); fireEvent.submit(form)
        expect(mocks.login).toHaveBeenCalledTimes(1)
        expect(screen.getByLabelText('Qual é o seu email?')).toBeDisabled()
        await act(async () => resolve(ack))
    })
    it('falha de login mantém campos e mostra erro persistente; nova tentativa recupera', async () => {
        mocks.login.mockRejectedValueOnce({ response: { status: 401, data: { message: 'Email ou senha inválidos' } } })
        mount(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Email ou senha inválidos')
        expect(screen.getByLabelText('Senha')).toHaveValue(' senha com espaços ')
        expect(mocks.save).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
        await screen.findByText('Início do motorista')
    })
    it('resposta incompleta não cria sessão nem anuncia sucesso', async () => {
        mocks.login.mockResolvedValue({ status: 200, data: { captain: { _id: 'c1' } } })
        mount(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
        await screen.findByRole('alert')
        expect(mocks.save).not.toHaveBeenCalled()
        expect(mocks.captain).not.toHaveBeenCalled()
    })
    it('resposta tardia após sair do login não autentica silenciosamente', async () => {
        let resolve
        mocks.login.mockImplementation(() => new Promise(done => { resolve = done }))
        mount(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
        fireEvent.click(screen.getByRole('link', { name: 'Esqueci a senha / preciso de ajuda' }))
        await screen.findByText('Ajuda sem autenticação')
        await act(async () => resolve(ack))
        expect(mocks.save).not.toHaveBeenCalled()
        expect(mocks.captain).not.toHaveBeenCalled()
    })
})
