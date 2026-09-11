import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { RideContext } from '@/shared/contexts/RideContext'
import AppUpdateGate, { requestAppUpdateCheck } from '@/shared/components/AppUpdateGate'
import CaptainHeader from '@/driver/components/CaptainHeader'
import { DRIVER_OVERLAY_BACK } from '@/shared/services/driverOverlayBack'

const mocks = vi.hoisted(() => ({ channel: 'play', check: vi.fn(), install: vi.fn(), resume: vi.fn(), toast: vi.fn(), dismiss: vi.fn() }))
vi.mock('@/shared/platform/appUpdate.service', () => ({
    getDriverUpdateChannel: () => mocks.channel, checkForUpdate: mocks.check,
    downloadAndInstall: mocks.install, resumeInstall: mocks.resume, dismissOptionalUpdate: mocks.dismiss,
    cancelDownload: vi.fn(), openApkFallback: vi.fn(),
}))
vi.mock('@/shared/platform/appLifecycle.service', () => ({ onAppActive: () => () => {} }))
vi.mock('@/shared/contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.toast }) }))
vi.mock('@/shared/components/NotificationBell', () => ({ default: () => null }))
vi.mock('@/shared/components/ui/InstallAppButton', () => ({ default: () => null }))
const available = { ok: true, available: true, installed: { versionName: '1.1.45' }, remote: { version: '1.1.46', versionCode: 48 } }
function mount(overrides = {}, header = false) {
    const tree = options => <MemoryRouter initialEntries={['/captain-home']}>
        <CaptainDataContext.Provider value={{ captain: { _id: 'c1', isOnline: options.online || false } }}>
            <RideContext.Provider value={{ captainRideReconciled: true, ...options }}>
                {header && <CaptainHeader />}
                <AppUpdateGate />
            </RideContext.Provider>
        </CaptainDataContext.Provider>
    </MemoryRouter>
    const view = render(tree(overrides))
    return { ...view, change: options => view.rerender(tree(options)) }
}
const request = () => act(() => requestAppUpdateCheck())
beforeEach(() => {
    vi.clearAllMocks(); mocks.channel = 'play'; sessionStorage.clear()
    mocks.check.mockResolvedValue(available); mocks.install.mockResolvedValue({ opened: true })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('atualização do motorista unificada por canal', () => {
    it('menu abre instrução da Play e link do pacote correto, sem verificar ou instalar APK', async () => {
        mount({}, true)
        fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }))
        expect(screen.getByRole('link', { name: 'Permissões do aplicativo' })).toHaveAttribute('href', '/captain/permissions')
        fireEvent.click(screen.getByRole('button', { name: 'Atualizar app' }))
        expect(await screen.findByRole('dialog', { name: 'Atualização do aplicativo' })).toHaveFocus()
        expect(screen.getByRole('link', { name: 'Abrir Google Play' })).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=br.com.movecity.driver')
        expect(mocks.check).not.toHaveBeenCalled()
        expect(mocks.install).not.toHaveBeenCalled()
        expect(screen.queryByText(/Você já está atualizado/)).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Fechar atualização' }))
        await act(async () => {})
        expect(screen.getByRole('button', { name: 'Abrir menu' })).toHaveFocus()
    })
    it('navegador não promete atualização ou recarrega automaticamente', () => {
        mocks.channel = 'web'; mount(); request()
        expect(screen.getByText(/Não há verificação automática/)).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Abrir Google Play' })).toBeNull()
        expect(mocks.check).not.toHaveBeenCalled()
    })
    it.each([
        { captainRide: { _id: 'r1', status: 'started' } },
        { captainRide: { _id: 'r1', status: 'accepted' } },
        { captainParcel: { _id: 'p1', status: 'in_transit' } },
        { captainRideReconciled: false },
        { online: true },
    ])('não interrompe atendimento/restauração/disponibilidade %j', options => {
        mocks.channel = 'sideload'; mount(options); request()
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(mocks.check).not.toHaveBeenCalled()
        expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('Conclua o atendimento'), 'info')
    })
    it('bloqueia dois cliques concorrentes inclusive verificação manual', async () => {
        mocks.channel = 'sideload'
        let resolve
        mocks.check.mockImplementation(() => new Promise(done => { resolve = done }))
        mount(); request(); request()
        expect(mocks.check).toHaveBeenCalledTimes(1)
        await act(async () => resolve(available))
        expect(screen.getByText('Nova versão disponível')).toBeInTheDocument()
        expect(mocks.install).not.toHaveBeenCalled()
    })
    it('erro de rede não anuncia versão atualizada', async () => {
        mocks.channel = 'sideload'; mocks.check.mockResolvedValue({ ok: false, offline: true })
        mount(); request()
        expect(await screen.findByText('Verificação falhou')).toBeInTheDocument()
        expect(screen.queryByText(/Você já está atualizado/)).toBeNull()
    })
    it('exceção inesperada tem retorno visível e permite nova consulta', async () => {
        mocks.channel = 'sideload'; mocks.check.mockRejectedValueOnce(new Error('bridge'))
        mount(); request()
        await screen.findByText('Verificação falhou')
        fireEvent.click(screen.getByRole('button', { name: 'OK' }))
        request()
        expect(await screen.findByText('Nova versão disponível')).toBeInTheDocument()
    })
    it('canal sem publicação não é tratado como versão atualizada', async () => {
        mocks.channel = 'sideload'; mocks.check.mockResolvedValue({ ok: true, available: false, reason: 'inactive' })
        mount(); request()
        expect(await screen.findByText('Nenhuma atualização publicada neste canal')).toBeInTheDocument()
        expect(screen.queryByText('Você já está atualizado')).toBeNull()
    })
    it('só informa atualizado com confirmação explícita do canal', async () => {
        mocks.channel = 'sideload'; mocks.check.mockResolvedValue({ ok: true, available: false, reason: 'up-to-date' })
        mount(); request()
        expect(await screen.findByText('Você já está atualizado')).toBeInTheDocument()
    })
    it('oferta aceita durante consulta adia o diálogo até o atendimento terminar', async () => {
        mocks.channel = 'sideload'
        let resolve
        mocks.check.mockImplementation(() => new Promise(done => { resolve = done }))
        const view = mount(); request()
        view.change({ captainRide: { _id: 'r1', status: 'started' } })
        await act(async () => resolve(available))
        expect(screen.queryByRole('dialog')).toBeNull()
        view.change({})
        expect(screen.getByText('Nova versão disponível')).toBeInTheDocument()
    })
    it('instalação é explícita, única e impede fechar durante download', async () => {
        mocks.channel = 'sideload'
        let resolve
        mocks.install.mockImplementation(() => new Promise(done => { resolve = done }))
        mount(); request()
        fireEvent.click(await screen.findByRole('button', { name: 'Atualizar agora' }))
        request()
        expect(mocks.install).toHaveBeenCalledTimes(1)
        expect(mocks.check).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('button', { name: 'Fechar atualização' })).toBeDisabled()
        act(() => window.dispatchEvent(new Event(DRIVER_OVERLAY_BACK, { cancelable: true })))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        await act(async () => resolve({ opened: true }))
        expect(screen.getByRole('button', { name: 'Fechar atualização' })).toBeEnabled()
    })
    it('voltar nativo fecha sem perder a sessão ou instalar', () => {
        mount(); request()
        act(() => window.dispatchEvent(new Event(DRIVER_OVERLAY_BACK, { cancelable: true })))
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(mocks.install).not.toHaveBeenCalled()
    })
    it('retoma o APK já baixado após autorização de instalação, sem baixar duas vezes', async () => {
        mocks.channel = 'sideload'
        mocks.install.mockResolvedValue({ needsPermission: true, localPath: '/cache/driver.apk' })
        mocks.resume.mockResolvedValue({ opened: true })
        mount(); request()
        fireEvent.click(await screen.findByRole('button', { name: 'Atualizar agora' }))
        await screen.findByText(/Ative a permissão para instalar pacotes/)
        // Outra consulta da mesma versão não invalida o download já verificado.
        request()
        await act(async () => {})
        fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }))
        await act(async () => {})
        expect(mocks.install).toHaveBeenCalledTimes(1)
        expect(mocks.resume).toHaveBeenCalledWith('/cache/driver.apk')
    })
})
