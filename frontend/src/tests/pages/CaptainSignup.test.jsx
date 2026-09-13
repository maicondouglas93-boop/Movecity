import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CaptainSignup from '@/driver/pages/CaptainSignup'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'

const state = vi.hoisted(() => ({ post: vi.fn(), categories: vi.fn(), upload: vi.fn(), toast: vi.fn(), captain: vi.fn(), save: vi.fn(), token: null }))
vi.mock('@/shared/services/axios', () => ({ default: { post: state.post } }))
vi.mock('@/shared/services/vehicleCategoriesApi', () => ({ getVehicleCategories: state.categories }))
vi.mock('@/shared/services/imageUpload', () => ({ isImageFile: () => true, postImageUpload: state.upload }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: () => state.token, saveSession: state.save }))
vi.mock('@/shared/services/swCommunication', () => ({ syncTokenWithSW: async () => {} }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: state.toast }) }))

const categories = [{ name: 'car', displayName: 'Carro' }]
const account = { token: 'new-token', refreshToken: 'new-refresh', captain: { _id: 'c1', fullname: { firstname: 'Ana' } } }

function mount() {
    return render(<MemoryRouter initialEntries={['/captain-signup']}>
        <CaptainDataContext.Provider value={{ setCaptain: state.captain }}>
            <Routes>
                <Route path="/captain-signup" element={<CaptainSignup />} />
                <Route path="/captain-home" element={<p>Início do motorista</p>} />
            </Routes>
        </CaptainDataContext.Provider>
    </MemoryRouter>)
}

async function fill() {
    const view = mount()
    await screen.findByRole('option', { name: 'Carro' })
    for (const [label, value] of Object.entries({ Nome: 'Ana', Sobrenome: 'Souza', 'E-mail': 'ANA@EXAMPLE.COM',
        Senha: ' senha123 ', 'Confirmar senha': ' senha123 ',
        'Categoria do Veículo': 'car', Marca: 'Marca', Modelo: 'Modelo', Ano: '2024', Cor: 'Branco', Placa: 'ABC1D23' })) {
        fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    return view
}

beforeEach(() => {
    vi.clearAllMocks()
    state.token = null
    state.categories.mockResolvedValue(categories)
    state.post.mockResolvedValue({ status: 201, data: account })
    state.upload.mockResolvedValue({ data: { captain: { _id: 'c1', profilePicture: 'https://images.test/photo.jpg' } } })
    state.save.mockImplementation((kind, data) => { state.token = data.token })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('cadastro do motorista com recuperação de conexão', () => {
    it('recupera as categorias após falha sem apagar o formulário', async () => {
        state.categories.mockRejectedValueOnce(new Error('offline'))
        mount()
        fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } })
        await screen.findByRole('alert')
        expect(screen.getByLabelText('Categoria do Veículo')).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar categorias novamente' }))
        await screen.findByRole('option', { name: 'Carro' })
        expect(screen.getByLabelText('Nome')).toHaveValue('Ana')
        expect(screen.getByLabelText('Categoria do Veículo')).toBeEnabled()
    })

    it('catálogo vazio explica a indisponibilidade e oferece suporte', async () => {
        state.categories.mockResolvedValue([])
        mount()
        expect(await screen.findByRole('alert')).toHaveTextContent('Nenhuma categoria')
        expect(screen.getByRole('link', { name: 'Pedir ajuda ao suporte' })).toHaveAttribute('href', '/captain-help?category=documents')
        expect(screen.getByRole('button', { name: 'Criar Conta' })).toBeDisabled()
    })

    it('categorias penduradas liberam uma nova tentativa após o teto de tempo', async () => {
        state.categories.mockImplementationOnce(() => new Promise(() => {}))
        vi.useFakeTimers()
        mount()
        await act(() => vi.advanceTimersByTimeAsync(12000))
        expect(screen.getByRole('button', { name: 'Tentar carregar categorias novamente' })).toBeEnabled()
    })

    it('cadastro sem resposta orienta login, não duplica o POST e ignora sucesso atrasado', async () => {
        let resolve
        state.post.mockImplementationOnce(() => new Promise(done => { resolve = done }))
        await fill()
        vi.useFakeTimers()
        const form = screen.getByRole('button', { name: 'Criar Conta' }).closest('form')
        fireEvent.submit(form)
        fireEvent.submit(form)
        expect(state.post).toHaveBeenCalledOnce()
        expect(state.post.mock.calls[0][1]).toMatchObject({ email: 'ana@example.com', password: ' senha123 ' })
        await act(() => vi.advanceTimersByTimeAsync(30000))
        expect(screen.getByRole('alert')).toHaveTextContent('Sua conta pode ter sido criada')
        expect(screen.getByRole('link', { name: 'Conferir meu acesso' })).toHaveAttribute('href', '/captain-login')
        expect(screen.getByRole('button', { name: 'Criar Conta' })).toBeDisabled()
        await act(async () => { resolve({ status: 201, data: account }) })
        expect(state.save).not.toHaveBeenCalled()
    })

    it('foto sem resposta mantém a conta criada e libera a entrada no app', async () => {
        state.upload.mockImplementationOnce(() => new Promise(() => {}))
        const view = await fill()
        fireEvent.change(view.container.querySelector('input[type=file]'), { target: { files: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] } })
        vi.useFakeTimers()
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Criar Conta' })) })
        expect(screen.getByRole('button', { name: /Conta criada. Enviando foto/ })).toBeDisabled()
        expect(state.save).toHaveBeenCalledWith('captain', account)
        await act(() => vi.advanceTimersByTimeAsync(15000))
        expect(screen.getByText('Início do motorista')).toBeInTheDocument()
        expect(state.token).toBe('new-token')
        expect(state.post).toHaveBeenCalledOnce()
        expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('Não foi possível confirmar a foto'), 'warning', 5000)
    })

    it('resposta incompleta não salva sessão nem anuncia conta criada', async () => {
        state.post.mockResolvedValue({ status: 201, data: { token: 'incomplete' } })
        await fill()
        fireEvent.click(screen.getByRole('button', { name: 'Criar Conta' }))
        await screen.findByRole('link', { name: 'Conferir meu acesso' })
        expect(state.save).not.toHaveBeenCalled()
        expect(state.captain).not.toHaveBeenCalled()
    })

    it('erro de validação mantém os dados e permite corrigir o cadastro', async () => {
        state.post.mockRejectedValue({ response: { status: 400, data: { message: 'Confira a placa' } } })
        await fill()
        fireEvent.click(screen.getByRole('button', { name: 'Criar Conta' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Confira a placa')
        expect(screen.getByLabelText('Nome')).toHaveValue('Ana')
        expect(screen.getByRole('button', { name: 'Criar Conta' })).toBeEnabled()
    })

    it('rodapé oferece links reais de privacidade e ajuda', async () => {
        await fill()
        expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('href', '/privacy')
        expect(screen.getByRole('link', { name: 'Ajuda com o cadastro' })).toHaveAttribute('href', '/captain-help?category=documents')
        expect(screen.queryByText(/reCAPTCHA/)).not.toBeInTheDocument()
    })
})
