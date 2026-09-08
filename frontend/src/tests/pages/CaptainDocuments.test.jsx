import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import CaptainDocuments from '@/driver/pages/CaptainDocuments'
import api from '@/shared/services/axios'
import { postDocumentImageUpload } from '@/shared/services/imageUpload'

const state = vi.hoisted(() => ({ owner: 'c1', current: null, set: null }))
vi.mock('@/shared/services/axios', () => ({ default: { patch: vi.fn() } }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: () => `token-${state.owner}`, getSessionOwnerId: () => state.owner }))
vi.mock('@/shared/services/imageUpload', async () => ({ ...await vi.importActual('@/shared/services/imageUpload'), postDocumentImageUpload: vi.fn() }))
const base = { _id: 'c1', isOnline: false, documents: {}, pix: { keyType: 'email', key: 'original@exemplo.com' } }
const url = 'https://storage.test/cnh.webp'
function Wrapper({ initial = base }) {
    const [captain, setCaptain] = useState(initial)
    state.current = captain; state.set = setCaptain
    return <MemoryRouter><CaptainDataContext.Provider value={{ captain, setCaptain }}><CaptainDocuments /></CaptainDataContext.Provider></MemoryRouter>
}
function select(label = 'CNH (verso)', file = new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })) {
    fireEvent.change(screen.getByLabelText(`Foto: ${label}`), { target: { files: [file] } })
}
beforeEach(() => {
    vi.clearAllMocks(); state.owner = 'c1'
    postDocumentImageUpload.mockResolvedValue({ data: { url } })
    api.patch.mockImplementation(async (_path, body) => ({ data: { captain: {
        ...base,
        ...(body.docType ? { documents: { [body.docType]: { url: body.url, verified: false, reason: '' } } } : body),
    } } }))
})
afterEach(cleanup)

describe('documentação: confirmação, isolamento e recuperação', () => {
    it('usa pipeline nativo existente e só altera a seção confirmada', async () => {
        render(<Wrapper />)
        select()
        await screen.findByText(/CNH \(verso\): envio confirmado/)
        expect(postDocumentImageUpload).toHaveBeenCalledWith(expect.stringContaining('/uploads/document'), expect.any(File), { token: 'token-c1', docType: 'cnhBack' })
        expect(api.patch).toHaveBeenCalledWith(expect.stringContaining('/captains/documents'), { docType: 'cnhBack', url }, { headers: { Authorization: 'Bearer token-c1' } })
        expect(state.current.documents.cnhBack.url).toBe(url)
        expect(state.current.pix).toEqual(base.pix)
    })
    it.each([new File(['pdf'], 'doc.pdf', { type: 'application/pdf' }), new File([], 'vazio.jpg', { type: 'image/jpeg' })])('rejeita arquivo inválido antes de enviar', file => {
        render(<Wrapper />); select('CNH (verso)', file)
        expect(screen.getByRole('alert')).toHaveTextContent('foto válida')
        expect(postDocumentImageUpload).not.toHaveBeenCalled()
    })
    it('rejeita imagem acima do limite', () => {
        render(<Wrapper />)
        const file = new File(['foto'], 'foto.jpg', { type: 'image/jpeg' })
        Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 + 1 })
        select('CNH (verso)', file)
        expect(screen.getByRole('alert')).toHaveTextContent('5 MB')
        expect(postDocumentImageUpload).not.toHaveBeenCalled()
    })
    it('upload recusado não faz PATCH nem anuncia sucesso', async () => {
        postDocumentImageUpload.mockRejectedValue(new Error('Falha no upload'))
        render(<Wrapper />); select()
        expect(await screen.findByRole('alert')).toHaveTextContent('Falha no upload')
        expect(api.patch).not.toHaveBeenCalled()
        expect(screen.queryByText(/envio confirmado/)).toBeNull()
    })
    it('falha de vínculo reutiliza upload no retry e conserva dados anteriores', async () => {
        api.patch.mockRejectedValueOnce(Object.assign(new Error('network'), { code: 'ERR_NETWORK' }))
        render(<Wrapper />); select()
        expect(await screen.findByRole('alert')).toHaveTextContent('falha de conexão')
        expect(state.current.documents).toEqual({})
        fireEvent.click(screen.getByRole('button', { name: 'Tentar este envio novamente' }))
        await screen.findByText(/envio confirmado/)
        expect(postDocumentImageUpload).toHaveBeenCalledTimes(1)
        expect(api.patch).toHaveBeenCalledTimes(2)
    })
    it('trava todos os envios inclusive CNH/Pix enquanto aguarda confirmação', async () => {
        let resolve
        postDocumentImageUpload.mockImplementation(() => new Promise(done => { resolve = done }))
        render(<Wrapper />); select(); select('CRLV')
        expect(postDocumentImageUpload).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('button', { name: 'Salvar CNH' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Salvar PIX' })).toBeDisabled()
        await act(async () => resolve({ data: { url } }))
        await screen.findByText(/envio confirmado/)
    })
    it('troca de sessão durante upload impede vincular a foto à outra conta', async () => {
        let resolve
        postDocumentImageUpload.mockImplementation(() => new Promise(done => { resolve = done }))
        render(<Wrapper />); select()
        state.owner = 'c2'
        act(() => state.set({ _id: 'c2', documents: {} }))
        await act(async () => resolve({ data: { url } }))
        expect(api.patch).not.toHaveBeenCalled()
        expect(state.current.documents).toEqual({})
        expect(screen.queryByText(/envio confirmado/)).toBeNull()
    })
    it('resposta tardia de PATCH não altera a nova conta', async () => {
        let resolve
        api.patch.mockImplementation(() => new Promise(done => { resolve = done }))
        render(<Wrapper />); select()
        await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
        state.owner = 'c2'; act(() => state.set({ _id: 'c2', documents: {} }))
        await act(async () => resolve({ data: { captain: { ...base, documents: { cnhBack: { url, verified: false } } } } }))
        expect(state.current._id).toBe('c2'); expect(state.current.documents).toEqual({})
    })
    it('ACK de outra conta ou documento não confirma envio', async () => {
        api.patch.mockResolvedValue({ data: { captain: { _id: 'c2', documents: { cnhBack: { url, verified: false } } } } })
        render(<Wrapper />); select()
        await screen.findByRole('alert')
        expect(state.current).toEqual(base)
        expect(screen.queryByText(/envio confirmado/)).toBeNull()
    })
    it('URL de upload ausente não vira vínculo vazio', async () => {
        postDocumentImageUpload.mockResolvedValue({ data: {} })
        render(<Wrapper />); select()
        await screen.findByRole('alert')
        expect(api.patch).not.toHaveBeenCalled()
    })
    it('mostra motivo da rejeição e exige ação explícita para substituir foto aprovada', () => {
        render(<Wrapper initial={{ ...base, documents: { cnhFront: { url, verified: true }, cnhBack: { url, reason: 'Foto cortada', verified: false } } }} />)
        expect(screen.getByText('Motivo informado: Foto cortada')).toBeInTheDocument()
        expect(screen.queryByLabelText('Foto: CNH (frente)')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Substituir foto aprovada' }))
        expect(screen.getByText(/retira a aprovação desta foto/)).toBeInTheDocument()
        expect(screen.getByLabelText('Foto: CNH (frente)')).toBeInTheDocument()
    })
    it('falha ao salvar mantém rascunho da CNH e não modifica Pix', async () => {
        api.patch.mockRejectedValueOnce(new Error('Tente novamente'))
        render(<Wrapper />)
        fireEvent.change(screen.getByLabelText('Número da CNH'), { target: { value: '123456' } })
        fireEvent.click(screen.getByRole('button', { name: 'Salvar CNH' }))
        await screen.findByRole('alert')
        expect(screen.getByLabelText('Número da CNH')).toHaveValue('123456')
        fireEvent.click(screen.getByRole('button', { name: 'Salvar CNH' }))
        await screen.findByText('CNH: dados salvos e confirmados.')
        expect(state.current.cnh.number).toBe('123456')
        expect(state.current.pix).toEqual(base.pix)
    })
    it('Pix inválido não envia; Pix confirmado não muda CNH', async () => {
        render(<Wrapper initial={{ ...base, cnh: { number: '123' }, pix: {} }} />)
        const form = within(screen.getByRole('region', { name: 'Recebimento Pix' }))
        fireEvent.submit(form.getByRole('button', { name: 'Salvar PIX' }).closest('form'))
        await screen.findByText(/Informe o tipo e a chave Pix/)
        expect(api.patch).not.toHaveBeenCalled()
        fireEvent.change(screen.getByLabelText('Tipo de chave Pix'), { target: { value: 'email' } })
        fireEvent.change(screen.getByLabelText('Chave Pix'), { target: { value: 'motorista@exemplo.com' } })
        fireEvent.click(screen.getByRole('button', { name: 'Salvar PIX' }))
        await screen.findByText('Pix: dados salvos e confirmados.')
        expect(state.current.cnh.number).toBe('123')
    })
    it('sem conta identificada não oferece envio ou status de documento inventado', () => {
        render(<Wrapper initial={{}} />)
        expect(screen.getByRole('status')).toHaveTextContent('Aguardando identificação')
        expect(screen.queryByText('Não enviado')).toBeNull()
    })
})
