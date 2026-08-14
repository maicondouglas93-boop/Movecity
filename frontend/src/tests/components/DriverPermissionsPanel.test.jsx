import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DriverPermissionsPanel from '@/driver/components/DriverPermissionsPanel'

const mocks = vi.hoisted(() => ({
    getPushPermissionStatus: vi.fn(),
    registerPush: vi.fn(),
    openDriverAppSettings: vi.fn(),
    onAppActive: vi.fn(() => vi.fn()),
}))

vi.mock('@/shared/platform/platform', () => ({
    isNativePlatform: () => true,
}))

vi.mock('@/shared/platform/notification.service', () => ({
    getPushPermissionStatus: mocks.getPushPermissionStatus,
    registerPush: mocks.registerPush,
}))

vi.mock('@/shared/platform/driverPermissions.service', () => ({
    openDriverAppSettings: mocks.openDriverAppSettings,
}))

vi.mock('@/shared/platform/appLifecycle.service', () => ({
    onAppActive: mocks.onAppActive,
}))

vi.mock('@/driver/components/DriverOemPermissionsCard', () => ({
    default: () => <div>Ajustes avançados</div>,
}))

describe('DriverPermissionsPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
    })

    it('não mostra falha quando a permissão e o token estão válidos', async () => {
        mocks.getPushPermissionStatus.mockResolvedValue({
            supported: true,
            granted: true,
            state: 'granted',
        })
        mocks.registerPush.mockResolvedValue('token-ok')

        render(<DriverPermissionsPanel />)

        expect(await screen.findByText('Ajustes avançados')).toBeInTheDocument()
        expect(screen.queryByText(/Não foi possível ativar notificações/i)).not.toBeInTheDocument()
    })

    it('pede permissão somente após o motorista tocar em Ativar', async () => {
        mocks.getPushPermissionStatus
            .mockResolvedValueOnce({ supported: true, granted: false, state: 'prompt' })
            .mockResolvedValue({ supported: true, granted: true, state: 'granted' })
        mocks.registerPush.mockResolvedValue('token-ok')

        render(<DriverPermissionsPanel />)

        expect(await screen.findByText('Ativar notificações de corrida?')).toBeInTheDocument()
        expect(mocks.registerPush).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))

        await waitFor(() => expect(mocks.registerPush).toHaveBeenCalledWith({
            requestPermission: true,
        }))
        expect(await screen.findByText('Ajustes avançados')).toBeInTheDocument()
    })

    it('explica corretamente quando a permissão existe mas o token falha', async () => {
        mocks.getPushPermissionStatus.mockResolvedValue({
            supported: true,
            granted: true,
            state: 'granted',
        })
        mocks.registerPush.mockResolvedValue(null)

        render(<DriverPermissionsPanel />)

        expect(await screen.findByText(
            'Notificações permitidas; sincronização pendente'
        )).toBeInTheDocument()
        expect(screen.getByText(/A permissão já está correta/)).toBeInTheDocument()
    })

    it('abre as configurações quando as notificações estão bloqueadas', async () => {
        mocks.getPushPermissionStatus.mockResolvedValue({
            supported: true,
            granted: false,
            state: 'denied',
        })

        render(<DriverPermissionsPanel />)

        fireEvent.click(await screen.findByRole('button', { name: 'Abrir configurações' }))
        expect(mocks.openDriverAppSettings).toHaveBeenCalledTimes(1)
    })

    it('respeita Agora não e não reapresenta o mesmo aviso imediatamente', async () => {
        mocks.getPushPermissionStatus.mockResolvedValue({
            supported: true,
            granted: false,
            state: 'prompt',
        })

        const { unmount } = render(<DriverPermissionsPanel />)
        fireEvent.click(await screen.findByRole('button', { name: 'Agora não' }))
        await waitFor(() => {
            expect(screen.queryByText('Ativar notificações de corrida?')).not.toBeInTheDocument()
        })

        unmount()
        render(<DriverPermissionsPanel />)
        await waitFor(() => expect(mocks.getPushPermissionStatus).toHaveBeenCalled())
        expect(screen.queryByText('Ativar notificações de corrida?')).not.toBeInTheDocument()
    })
})
