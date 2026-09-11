import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DriverOemPermissionsCard from '@/driver/components/DriverOemPermissionsCard'

const mocks = vi.hoisted(() => ({
    getStatus: vi.fn(), openOverlaySettings: vi.fn(), native: true, resume: null,
}))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => mocks }))
vi.mock('@/shared/platform/platform', () => ({ isNativePlatform: () => mocks.native }))
vi.mock('@/shared/platform/appLifecycle.service', () => ({
    onAppActive: (callback) => { mocks.resume = callback; return vi.fn() },
}))
vi.mock('@/shared/platform/location.service', () => ({ requestLocationPermission: vi.fn() }))

const ready = {
    canDrawOverlays: true,
    supportsFullScreenIntent: false,
    canUseFullScreenIntent: false,
    ignoringBatteryOptimizations: true,
    hasNotificationPolicyAccess: true,
    hasForegroundLocation: true,
    hasBackgroundLocation: true,
    isXiaomiFamily: false,
}

describe('tela nativa de oferta — autorização de sobreposição', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
        mocks.native = true
        mocks.resume = null
        mocks.getStatus.mockResolvedValue({ ...ready, canDrawOverlays: false })
        mocks.openOverlaySettings.mockResolvedValue(undefined)
    })

    it('explica a permissão opcional e abre o Android somente após o toque', async () => {
        render(<DriverOemPermissionsCard />)
        const button = await screen.findByRole('button', { name: /Permitir aparecer sobre outros apps/ })
        expect(screen.getByText(/É opcional/)).toBeInTheDocument()
        expect(mocks.openOverlaySettings).not.toHaveBeenCalled()
        fireEvent.click(button)
        await waitFor(() => expect(mocks.openOverlaySettings).toHaveBeenCalledTimes(1))
    })

    it('não pede a permissão FSI removida do pacote Play', async () => {
        render(<DriverOemPermissionsCard />)
        await screen.findByRole('button', { name: /Permitir aparecer sobre outros apps/ })
        expect(screen.queryByRole('button', { name: /Permitir tela cheia/ })).not.toBeInTheDocument()
    })

    it('reconsulta ao voltar e some somente quando o Android confirma', async () => {
        render(<DriverOemPermissionsCard />)
        await screen.findByRole('button', { name: /Permitir aparecer sobre outros apps/ })
        await act(async () => { await mocks.resume() })
        expect(screen.getByRole('button', { name: /Permitir aparecer sobre outros apps/ })).toBeInTheDocument()
        mocks.getStatus.mockResolvedValue(ready)
        await act(async () => { await mocks.resume() })
        expect(screen.queryByText('Receber ofertas sobre outros aplicativos')).not.toBeInTheDocument()
    })

    it('já configurei não oculta uma permissão ainda negada', async () => {
        render(<DriverOemPermissionsCard />)
        fireEvent.click(await screen.findByRole('button', { name: /Já configurei/ }))
        await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(2))
        expect(screen.getByRole('button', { name: /Permitir aparecer sobre outros apps/ })).toBeInTheDocument()
    })

    it('informa falha ao abrir configurações sem dizer que autorizou', async () => {
        mocks.openOverlaySettings.mockRejectedValue(new Error('Settings unavailable'))
        render(<DriverOemPermissionsCard />)
        fireEvent.click(await screen.findByRole('button', { name: /Permitir aparecer sobre outros apps/ }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir')
    })

    it('respeita Agora não e não reabre configurações automaticamente', async () => {
        render(<DriverOemPermissionsCard />)
        fireEvent.click(await screen.findByRole('button', { name: 'Agora não' }))
        await act(async () => { await mocks.resume() })
        expect(screen.queryByText('Receber ofertas sobre outros aplicativos')).not.toBeInTheDocument()
        expect(mocks.openOverlaySettings).not.toHaveBeenCalled()
    })

    it('a dispensa antiga não esconde o novo opt-in após atualização', async () => {
        localStorage.setItem('driverOemPermsSeen_v1', String(Date.now()))
        render(<DriverOemPermissionsCard />)
        expect(await screen.findByRole('button', { name: /Permitir aparecer sobre outros apps/ })).toBeInTheDocument()
    })

    it('não mostra configurações Android no navegador', () => {
        mocks.native = false
        render(<DriverOemPermissionsCard />)
        expect(mocks.getStatus).not.toHaveBeenCalled()
        expect(screen.queryByText('Receber ofertas sobre outros aplicativos')).not.toBeInTheDocument()
    })
})
