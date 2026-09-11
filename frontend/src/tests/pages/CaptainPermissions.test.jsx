import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CaptainPermissions from '@/driver/pages/CaptainPermissions'

const mocks = vi.hoisted(() => ({
    native: true, resume: null, off: vi.fn(), status: vi.fn(), push: vi.fn(),
    settings: vi.fn(), location: vi.fn(), background: vi.fn(), register: vi.fn(),
}))
vi.mock('@/shared/platform/platform', () => ({ isNativePlatform: () => mocks.native }))
vi.mock('@/shared/platform/appLifecycle.service', () => ({ onAppActive: callback => { mocks.resume = callback; return mocks.off } }))
vi.mock('@/shared/platform/driverPermissions.service', () => ({
    getDriverPermissionStatus: mocks.status, openDriverPermissionSettings: mocks.settings,
    requestBackgroundLocationPermission: mocks.background,
}))
vi.mock('@/shared/platform/notification.service', () => ({ getPushPermissionStatus: mocks.push, registerPush: mocks.register }))
vi.mock('@/shared/platform/location.service', () => ({ requestLocationPermission: mocks.location }))

const ready = {
    sdkInt: 36, canDrawOverlays: false, notificationsEnabled: true, offerAlertsConfigured: true,
    hasForegroundLocation: true, hasBackgroundLocation: false, ignoringBatteryOptimizations: true,
    supportsFullScreenIntent: false, canUseFullScreenIntent: false, hasNotificationPolicyAccess: false,
    isXiaomiFamily: false,
}
const region = name => within(screen.getByRole('region', { name }))
async function mount() {
    const result = render(<MemoryRouter><CaptainPermissions /></MemoryRouter>)
    if (mocks.native) await screen.findByText('Confira abaixo o estado informado pelo Android.')
    return result
}
beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.native = true
    mocks.resume = null
    mocks.status.mockResolvedValue({ ...ready })
    mocks.push.mockResolvedValue({ supported: true, granted: true, state: 'granted' })
    mocks.settings.mockResolvedValue(undefined)
    mocks.location.mockResolvedValue({ granted: true, state: 'granted' })
    mocks.background.mockResolvedValue({ granted: true, state: 'granted' })
    mocks.register.mockResolvedValue('token')
})

describe('central permanente de permissões do motorista', () => {
    it('mostra botões mesmo após dispensar os avisos e sem registro FCM automático', async () => {
        localStorage.setItem('driverOemPermsSeen_v2', String(Date.now()))
        localStorage.setItem('driverPermissionNoticeSnooze_v2', JSON.stringify({ issue: 'registration_failed', until: Date.now() + 90000 }))
        await mount()
        expect(screen.getByRole('button', { name: 'Autorizar aparecer sobre outros apps' })).toBeEnabled()
        expect(mocks.status).toHaveBeenCalledWith({ strict: true })
        expect(mocks.settings).not.toHaveBeenCalled()
        expect(mocks.register).not.toHaveBeenCalled()
        expect(mocks.location).not.toHaveBeenCalled()
        expect(screen.queryByRole('button', { name: 'Agora não' })).not.toBeInTheDocument()
    })

    it('abre a sobreposição após o toque e não confunde abrir configurações com autorizar', async () => {
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Autorizar aparecer sobre outros apps' }))
        await waitFor(() => expect(mocks.settings).toHaveBeenCalledWith('overlay'))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Autorizar aparecer sobre outros apps' })).toBeEnabled())
        expect(region('Tela de oferta sobre outros apps').getByText('Não ativado')).toBeInTheDocument()
        mocks.status.mockResolvedValue({ ...ready, canDrawOverlays: true })
        await act(async () => { await mocks.resume() })
        expect(region('Tela de oferta sobre outros apps').getByText('Ativado')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Revisar: Tela de oferta sobre outros apps' })).toBeInTheDocument()
    })

    it('não pede Full Screen Intent ausente da distribuição Play', async () => {
        await mount()
        expect(screen.queryByRole('region', { name: 'Ofertas em tela cheia' })).not.toBeInTheDocument()
    })

    it('oferece tela cheia somente quando a distribuição declara a permissão', async () => {
        mocks.status.mockResolvedValue({ ...ready, supportsFullScreenIntent: true })
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Configurar tela cheia' }))
        await waitFor(() => expect(mocks.settings).toHaveBeenCalledWith('fullScreen'))
    })

    it('informa falha na leitura sem inventar permissões concedidas e permite tentar novamente', async () => {
        mocks.status.mockRejectedValue(new Error('Plugin unavailable'))
        await mount()
        expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível conferir')
        expect(screen.queryByText('Ativado')).not.toBeInTheDocument()
        mocks.status.mockResolvedValue(ready)
        fireEvent.click(screen.getByRole('button', { name: 'Verificar autorizações novamente' }))
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    })

    it('exibe erro ao falhar o atalho e mantém alternativa nas informações do app', async () => {
        mocks.settings.mockRejectedValueOnce(new Error('Missing activity'))
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Autorizar aparecer sobre outros apps' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir')
        await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir configurações do aplicativo' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Abrir configurações do aplicativo' }))
        await waitFor(() => expect(mocks.settings).toHaveBeenLastCalledWith('app'))
    })

    it('respeita notificações bloqueadas no Android mesmo se o plugin Push diz granted', async () => {
        mocks.status.mockResolvedValue({ ...ready, notificationsEnabled: false })
        await mount()
        expect(region('Notificações de corridas').getByText('Não ativado')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Autorizar notificações' }))
        await waitFor(() => expect(mocks.settings).toHaveBeenCalledWith('notifications'))
        expect(mocks.register).not.toHaveBeenCalled()
    })

    it('só solicita a permissão de push após toque e separa registro pendente de permissão', async () => {
        mocks.status.mockResolvedValue({ ...ready, notificationsEnabled: false })
        mocks.push.mockResolvedValue({ supported: true, granted: false, state: 'prompt' })
        mocks.register.mockResolvedValue(null)
        await mount()
        mocks.push.mockResolvedValue({ supported: true, granted: true, state: 'granted' })
        fireEvent.click(screen.getByRole('button', { name: 'Autorizar notificações' }))
        await waitFor(() => expect(mocks.register).toHaveBeenCalledWith({ requestPermission: true }))
        expect(await screen.findByText(/O registro para receber ofertas ainda precisa/)).toBeInTheDocument()
    })

    it('abre o canal de ofertas para configurar som separadamente', async () => {
        mocks.status.mockResolvedValue({ ...ready, offerAlertsConfigured: false })
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Configurar som e alertas' }))
        await waitFor(() => expect(mocks.settings).toHaveBeenCalledWith('offers'))
    })

    it('explica a localização em segundo plano antes de abrir settings no Android 11+', async () => {
        await mount()
        expect(region('Localização o tempo todo').getByText(/O MoveCity coleta sua localização em segundo plano/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Localização o tempo todo' }))
        await waitFor(() => expect(mocks.settings).toHaveBeenCalledWith('app'))
        expect(mocks.background).not.toHaveBeenCalled()
    })

    it('não pede background junto com a primeira permissão de localização', async () => {
        mocks.status.mockResolvedValue({ ...ready, hasForegroundLocation: false })
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Localização o tempo todo' }))
        await waitFor(() => expect(mocks.location).toHaveBeenCalledTimes(1))
        expect(mocks.background).not.toHaveBeenCalled()
        expect(mocks.settings).not.toHaveBeenCalled()
        expect(await screen.findByText(/toque novamente em/)).toBeInTheDocument()
    })

    it('usa pedido separado de background no Android 10', async () => {
        mocks.status.mockResolvedValue({ ...ready, sdkInt: 29 })
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Localização o tempo todo' }))
        await waitFor(() => expect(mocks.background).toHaveBeenCalledTimes(1))
    })

    it('permite revisar localização já concedida sem um botão sem efeito', async () => {
        mocks.status.mockResolvedValue({ ...ready, hasBackgroundLocation: true, sdkInt: 29 })
        await mount()
        fireEvent.click(screen.getByRole('button', { name: 'Revisar: Localização durante o uso' }))
        await waitFor(() => expect(mocks.settings).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Revisar: Localização o tempo todo' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Revisar: Localização o tempo todo' }))
        await waitFor(() => expect(mocks.settings).toHaveBeenCalledTimes(2))
        expect(mocks.settings).toHaveBeenLastCalledWith('app')
        expect(mocks.location).not.toHaveBeenCalled()
        expect(mocks.background).not.toHaveBeenCalled()
    })

    it('mostra atalhos extras Xiaomi sem dizer que as permissões OEM estão confirmadas', async () => {
        mocks.status.mockResolvedValue({ ...ready, isXiaomiFamily: true })
        mocks.settings.mockResolvedValue({ oemSpecific: false })
        await mount()
        expect(screen.getAllByText('Conferir no Android')).toHaveLength(2)
        fireEvent.click(screen.getByRole('button', { name: 'Autorizar janelas em segundo plano' }))
        await waitFor(() => expect(mocks.settings).toHaveBeenCalledWith('oem'))
        expect(await screen.findByText(/O fabricante não disponibilizou o atalho direto/)).toBeInTheDocument()
    })

    it('não abre duas configurações por toque repetido', async () => {
        let complete
        mocks.settings.mockImplementation(() => new Promise(resolve => { complete = resolve }))
        await mount()
        const button = screen.getByRole('button', { name: 'Autorizar aparecer sobre outros apps' })
        fireEvent.click(button)
        fireEvent.click(button)
        expect(mocks.settings).toHaveBeenCalledTimes(1)
        await act(async () => { complete() })
    })

    it('remove listener e ignora respostas de leitura anteriores ao retorno do Android', async () => {
        const { unmount } = await mount()
        let stale
        mocks.status.mockImplementationOnce(() => new Promise(resolve => { stale = resolve }))
        fireEvent.click(screen.getByRole('button', { name: 'Verificar autorizações novamente' }))
        mocks.status.mockResolvedValue({ ...ready, canDrawOverlays: true })
        await act(async () => { await mocks.resume() })
        await act(async () => { stale({ ...ready, canDrawOverlays: false }) })
        expect(region('Tela de oferta sobre outros apps').getByText('Ativado')).toBeInTheDocument()
        unmount()
        expect(mocks.off).toHaveBeenCalled()
    })

    it('no navegador explica a diferença e não chama APIs Android', async () => {
        mocks.native = false
        await mount()
        expect(screen.getByText(/Esses botões estão disponíveis no aplicativo Android/)).toBeInTheDocument()
        expect(mocks.status).not.toHaveBeenCalled()
        expect(mocks.settings).not.toHaveBeenCalled()
        expect(mocks.resume).toBeNull()
    })
})
