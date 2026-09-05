import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), clear: vi.fn() }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => native }))
vi.mock('@/shared/platform/platform', () => ({ isNativePlatform: () => true }))
import { saveSession, getAccessToken, getRefreshToken, clearSession } from '@/shared/services/session'
import { initializeNativeCaptainSession, restoreNativeCaptainSession, syncNativeCaptainSession } from '@/shared/platform/nativeSession.service'

const stored = { token: 'native-access', refreshToken: 'native-refresh', apiBase: 'https://api.example.test', updatedAt: 200 }
const webSession = (updatedAt = 100) => saveSession('captain', { token: 'web-access', refreshToken: 'web-refresh' }, { syncNative: false, updatedAt })

describe('sessão Android entre atualizações e aceite em segundo plano', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.resetAllMocks()
        vi.stubEnv('VITE_BASE_URL', stored.apiBase)
        native.read.mockResolvedValue(stored)
        native.save.mockResolvedValue({})
        native.clear.mockResolvedValue({})
    })
    afterEach(() => vi.unstubAllEnvs())

    it('restaura tokens quando o armazenamento da WebView está vazio após atualização', async () => {
        await initializeNativeCaptainSession()
        expect(getAccessToken('captain')).toBe(stored.token)
        expect(getRefreshToken('captain')).toBe(stored.refreshToken)
        expect(native.clear).not.toHaveBeenCalled()
        expect(native.save).not.toHaveBeenCalled()
    })
    it('recupera o refresh mais recente gravado pelo aceite nativo', async () => {
        webSession()
        await restoreNativeCaptainSession()
        expect(getRefreshToken('captain')).toBe(stored.refreshToken)
    })
    it('preserva uma sessão web mais recente e atualiza a cópia nativa', async () => {
        webSession(300)
        await initializeNativeCaptainSession()
        expect(getAccessToken('captain')).toBe('web-access')
        expect(native.save).toHaveBeenCalledWith(expect.objectContaining({ token: 'web-access' }))
    })
    it('não recupera credenciais de outro servidor', async () => {
        native.read.mockResolvedValue({ ...stored, apiBase: 'https://outro.example.test' })
        await initializeNativeCaptainSession()
        expect(getAccessToken('captain')).toBeNull()
    })
    it('logout explícito impede restaurar uma cópia antiga', async () => {
        clearSession('captain')
        await initializeNativeCaptainSession()
        expect(getAccessToken('captain')).toBeNull()
        expect(native.read).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(native.clear).toHaveBeenCalled())
    })
    it('leitura atrasada não sobrescreve um novo login', async () => {
        let finish
        native.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
        const pending = restoreNativeCaptainSession()
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
        webSession(300)
        finish(stored)
        await pending
        expect(getAccessToken('captain')).toBe('web-access')
    })
    it('falha da ponte não apaga nem sobrescreve credenciais', async () => {
        webSession()
        native.read.mockRejectedValueOnce(new Error('Ponte indisponível'))
        await initializeNativeCaptainSession()
        expect(getAccessToken('captain')).toBe('web-access')
        expect(native.save).not.toHaveBeenCalled()
        expect(native.clear).not.toHaveBeenCalled()
    })
    it('sincronização sem token não significa logout', async () => {
        await syncNativeCaptainSession()
        expect(native.clear).not.toHaveBeenCalled()
    })
})
