import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDriverUpdateChannel } from '@/shared/platform/appUpdate.service'
import { usePwaUpdate } from '@/shared/contexts/PwaUpdateContext'

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('contrato de atualização e plataforma', () => {
    it.each([['play', 'play'], ['sideload', 'sideload'], ['', 'sideload']])('Android %s usa %s', (channel, expected) => {
        vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
        vi.stubEnv('VITE_DISTRIBUTION_CHANNEL', channel)
        expect(getDriverUpdateChannel()).toBe(expected)
    })
    it('navegador não usa APK nem Play mesmo que bundle tenha canal play', () => {
        vi.stubGlobal('Capacitor', { isNativePlatform: () => false })
        vi.stubEnv('VITE_DISTRIBUTION_CHANNEL', 'play')
        expect(getDriverUpdateChannel()).toBe('web')
    })
    it('PWA sem provider devolve false booleano, nunca objeto truthy', async () => {
        const { result } = renderHook(() => usePwaUpdate())
        expect(await result.current.checkForUpdate()).toBe(false)
    })
})
