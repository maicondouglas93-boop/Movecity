import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDriverPermissionStatus, openDriverPermissionSettings } from '@/shared/platform/driverPermissions.service'

const mocks = vi.hoisted(() => ({ native: true, getStatus: vi.fn(), openOverlaySettings: vi.fn(), openNotificationSettings: vi.fn() }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => mocks }))
vi.mock('@/shared/platform/platform', () => ({ isNativePlatform: () => mocks.native }))
beforeEach(() => { vi.clearAllMocks(); mocks.native = true })
describe('atalhos da central de permissões', () => {
    it('não mascara falhas de leitura no modo estrito', async () => {
        mocks.getStatus.mockRejectedValue(new Error('Bridge unavailable'))
        await expect(getDriverPermissionStatus({ strict: true })).rejects.toThrow('Bridge unavailable')
    })
    it('encaminha atalho e propaga falha de settings para a interface', async () => {
        mocks.openOverlaySettings.mockRejectedValue(new Error('Settings unavailable'))
        await expect(openDriverPermissionSettings('overlay')).rejects.toThrow('Settings unavailable')
        mocks.openNotificationSettings.mockResolvedValue(undefined)
        await openDriverPermissionSettings('notifications')
        expect(mocks.openNotificationSettings).toHaveBeenCalledTimes(1)
    })
    it('rejeita configurações desconhecidas sem chamar o plugin', async () => {
        await expect(openDriverPermissionSettings('constructor')).rejects.toThrow('Configuração desconhecida')
        expect(mocks.openOverlaySettings).not.toHaveBeenCalled()
    })
    it('não chama o Android no navegador', async () => {
        mocks.native = false
        await expect(openDriverPermissionSettings('overlay')).rejects.toThrow('Disponível no aplicativo Android')
        expect(mocks.openOverlaySettings).not.toHaveBeenCalled()
    })
})
