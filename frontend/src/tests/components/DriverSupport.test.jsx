import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import DriverSupportContent from '@/driver/components/DriverSupportContent'
import ApprovalGate from '@/driver/components/ApprovalGate'
import { supportEmailUrl } from '@/shared/utils/supportContacts'

const mocks = vi.hoisted(() => ({ version: vi.fn() }))
vi.mock('@/shared/platform/appUpdate.service', () => ({ getInstalledVersion: mocks.version, getDriverUpdateChannel: () => 'play' }))
const account = { _id: 'driver-private', email: 'private@exemplo.com', password: 'secret123', pix: { key: 'private-pix' }, documents: { cnhFront: { url: 'https://private/document.jpg' } }, location: { lat: 12, lng: 34 } }
function tree(captain, category = 'access') {
    return <MemoryRouter initialEntries={[`/captain-help?category=${category}`]}><CaptainDataContext.Provider value={{ captain }}><DriverSupportContent /></CaptainDataContext.Provider></MemoryRouter>
}
beforeEach(() => { vi.clearAllMocks(); mocks.version.mockResolvedValue({ versionName: '1.1.45' }) })
afterEach(cleanup)
describe('suporte sem protocolo ou recuperação fictícios', () => {
    it('acesso sem login orienta recuperação assistida sem limpar dados', async () => {
        render(tree(null))
        expect(screen.getByRole('region', { name: 'Recuperação de acesso' })).toHaveTextContent('ainda não oferece redefinição automática')
        expect(screen.getByText(/Não desinstale nem limpe os dados/)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Abrir WhatsApp do suporte' })).toHaveAttribute('href', expect.stringContaining('wa.me/'))
        await act(async () => {})
    })
    it('não inclui segredo, e-mail, Pix, documento, localização ou ID automaticamente', async () => {
        render(tree(account, 'app')); await act(async () => {})
        const message = screen.getByLabelText('Mensagem que será aberta').value
        for (const secret of ['driver-private', 'private@', 'secret123', 'private-pix', 'document.jpg', 'lat']) expect(message).not.toContain(secret)
        expect(message).toContain('1.1.45'); expect(message).toContain('Google Play')
    })
    it('ID de conta só entra após consentimento; nova conta remove consentimento e rascunho', async () => {
        const view = render(tree(account)); await act(async () => {})
        fireEvent.click(screen.getByRole('checkbox'))
        fireEvent.change(screen.getByLabelText('Descreva o problema (opcional)'), { target: { value: 'Pedido da conta anterior' } })
        expect(screen.getByLabelText('Mensagem que será aberta').value).toContain('driver-private')
        view.rerender(tree({ _id: 'another-driver' }))
        expect(screen.getByRole('checkbox')).not.toBeChecked()
        expect(screen.getByLabelText('Mensagem que será aberta').value).not.toContain('driver-private')
        expect(screen.getByLabelText('Descreva o problema (opcional)')).toHaveValue('')
    })
    it('categorias mudam assunto e mensagem externa, não criam ticket', async () => {
        render(tree(null)); await act(async () => {})
        fireEvent.change(screen.getByLabelText('Assunto'), { target: { value: 'payment' } })
        fireEvent.change(screen.getByLabelText('Descreva o problema (opcional)'), { target: { value: 'Dúvida no recibo' } })
        expect(decodeURIComponent(screen.getByRole('link', { name: 'Abrir e-mail do suporte' }).getAttribute('href'))).toContain('subject=Motorista — Pagamento')
        expect(screen.getByText(/não cria um protocolo/)).toBeInTheDocument()
    })
    it('categoria inválida volta para Aplicativo; falha de versão não inventa número', async () => {
        mocks.version.mockRejectedValue(new Error('indisponível'))
        render(tree(null, 'malicious')); await act(async () => {})
        expect(screen.getByLabelText('Assunto')).toHaveValue('app')
        expect(screen.getByLabelText('Mensagem que será aberta').value).toContain('Versão: Não informada')
    })
    it('canal de segurança não promete atendimento de emergência ou prazo', async () => {
        render(tree(null, 'safety')); await act(async () => {})
        expect(screen.getByRole('status')).toHaveTextContent('não substitui atendimento de emergência')
        expect(screen.queryByText(/48 horas|24 horas/)).toBeNull()
    })
    it('mantém assunto de finalização dos chamadores antigos do e-mail', () => {
        expect(decodeURIComponent(supportEmailUrl('Teste'))).toContain('Motorista — finalização pendente')
    })
})
describe('aprovação: status verdadeiro e próximo passo', () => {
    it('em análise não promete 48 horas e oferece documento/suporte', () => {
        render(<MemoryRouter><ApprovalGate captain={{ approvalStatus: 'em_analise' }} /></MemoryRouter>)
        expect(screen.getByText(/não informa prazo/)).toBeInTheDocument()
        expect(screen.queryByText(/48 horas/)).toBeNull()
        expect(screen.getByRole('button', { name: 'Ver documentos e pendências' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Falar com o suporte' })).toBeInTheDocument()
    })
    it('status desconhecido não é tratado como análise confirmada', () => {
        render(<MemoryRouter><ApprovalGate captain={{ approvalStatus: 'unknown' }} /></MemoryRouter>)
        expect(screen.getByRole('heading')).toHaveTextContent('Status da conta indisponível')
    })
    it('bloqueio de conta não é apresentado como reprovação de documentos', () => {
        render(<MemoryRouter><ApprovalGate captain={{ isBlocked: true, approvalStatus: 'aprovado' }} /></MemoryRouter>)
        expect(screen.getByRole('heading')).toHaveTextContent('Conta bloqueada')
    })
    it('expiração do envio não promete desbloqueio automático', () => {
        render(<MemoryRouter><ApprovalGate captain={{ approvalStatus: 'expirado' }} /></MemoryRouter>)
        expect(screen.getByText(/não reativa a conta automaticamente/)).toBeInTheDocument()
    })
})
