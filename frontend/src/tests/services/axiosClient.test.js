import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fase 1 da auditoria de production readiness (C1, 2026-08-05): os fluxos críticos
// migraram do axios cru para esta instância. Estes testes provam o contrato que a
// migração depende: timeout, withCredentials, injeção de token, respeito ao
// Authorization explícito (sessão dupla), refresh em 401 com retry único (sem loop)
// e nenhum logout por erro de rede.

vi.mock('@/shared/services/swCommunication', () => ({
    syncTokenWithSW: vi.fn(),
    clearTokenInSW: vi.fn(),
}))

const { default: api, refreshAccessToken } = await import('@/shared/services/axios')
const {
    clearAllSessions,
    getAccessToken,
    saveSession,
} = await import('@/shared/services/session')

const originalAdapter = api.defaults.adapter

const okResponse = (config, data = {}) => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
})

const http401 = (config) => {
    const err = new Error('Request failed with status code 401')
    err.config = config
    err.response = { status: 401, data: { message: 'Unauthorized' }, headers: {}, config }
    return err
}

const networkError = (config) => {
    const err = new Error('Network Error')
    err.config = config
    // sem err.response — é assim que o axios representa timeout/queda de rede
    return err
}

const authHeaderOf = (config) =>
    config.headers?.Authorization ?? config.headers?.get?.('Authorization')

describe('cliente axios configurado (Fase 1 — C1)', () => {
    beforeEach(() => {
        localStorage.clear()
        clearAllSessions()
    })

    afterEach(() => {
        api.defaults.adapter = originalAdapter
    })

    it('tem timeout de 10s e withCredentials habilitado', () => {
        expect(api.defaults.timeout).toBe(10000)
        expect(api.defaults.withCredentials).toBe(true)
    })

    it('injeta o token da sessão certa quando o chamador não passa Authorization', async () => {
        saveSession('user', { token: 'user-token' })
        const adapter = vi.fn(async (config) => okResponse(config))
        api.defaults.adapter = adapter

        await api.get('/users/profile')

        expect(authHeaderOf(adapter.mock.calls[0][0])).toBe('Bearer user-token')
    })

    it('respeita Authorization explícito — não sobrescreve com o fallback user>captain (sessão dupla)', async () => {
        // Cenário real: motorista e passageiro logados no mesmo navegador; a rota
        // /wallet não é classificável por sessionKindForUrl e o fallback preferiria
        // o token de USER. O header explícito do chamador tem que vencer.
        saveSession('user', { token: 'user-token' })
        saveSession('captain', { token: 'captain-token' })
        const adapter = vi.fn(async (config) => okResponse(config))
        api.defaults.adapter = adapter

        await api.get('/wallet/transactions', {
            headers: { Authorization: 'Bearer captain-token' },
        })

        expect(authHeaderOf(adapter.mock.calls[0][0])).toBe('Bearer captain-token')
    })

    it('401 dispara UM refresh e repete a requisição original com o token novo', async () => {
        saveSession('user', { token: 'token-vencido' })

        const calls = []
        api.defaults.adapter = vi.fn(async (config) => {
            calls.push(config.url)
            if (config.url.includes('/users/refresh')) {
                return okResponse(config, { token: 'token-novo', refreshToken: 'refresh-novo' })
            }
            if (calls.filter((u) => u.includes('/users/profile')).length === 1) {
                throw http401(config)
            }
            return okResponse(config, { fullname: { firstname: 'Ana' } })
        })

        const response = await api.get('/users/profile')

        expect(response.status).toBe(200)
        // original (401) → refresh → retry: exatamente 3 chamadas, sem loop
        expect(calls).toHaveLength(3)
        expect(calls[1]).toContain('/users/refresh')
        expect(getAccessToken('user')).toBe('token-novo')
        expect(localStorage.getItem('token')).toBeNull()
        expect(localStorage.getItem('refreshToken')).toBeNull()
    })

    it('renova passageiro e motorista em filas independentes sem trocar os tokens', async () => {
        const refreshCalls = []
        api.defaults.adapter = vi.fn(async (config) => {
            refreshCalls.push(config.url)
            if (config.url.includes('/captains/refresh')) {
                return okResponse(config, { token: 'captain-novo' })
            }
            return okResponse(config, { token: 'user-novo' })
        })

        const [userToken, captainToken] = await Promise.all([
            refreshAccessToken('user'),
            refreshAccessToken('captain'),
        ])

        expect(userToken).toBe('user-novo')
        expect(captainToken).toBe('captain-novo')
        expect(getAccessToken('user')).toBe('user-novo')
        expect(getAccessToken('captain')).toBe('captain-novo')
        expect(refreshCalls).toEqual(expect.arrayContaining(['/users/refresh', '/captains/refresh']))
    })

    it('erro de rede (sem resposta HTTP) NÃO desloga e devolve friendlyMessage', async () => {
        saveSession('user', { token: 'user-token' })
        api.defaults.adapter = vi.fn(async (config) => {
            throw networkError(config)
        })

        await expect(api.get('/users/profile')).rejects.toMatchObject({
            friendlyMessage: expect.any(String),
        })
        // A sessão sobrevive à instabilidade de rede — era o bug antigo.
        expect(getAccessToken('user')).toBe('user-token')
    })

    it('falha de rede durante o refresh não apaga a sessão nem o token em memória', async () => {
        saveSession('user', { token: 'user-token-curto' })
        api.defaults.adapter = vi.fn(async (config) => {
            throw networkError(config)
        })

        await expect(refreshAccessToken('user')).rejects.toBeTruthy()
        expect(getAccessToken('user')).toBe('user-token-curto')
    })

    it('401 no login não tenta refresh (credencial errada não é sessão expirada)', async () => {
        const calls = []
        api.defaults.adapter = vi.fn(async (config) => {
            calls.push(config.url)
            throw http401(config)
        })

        await expect(api.post('/users/login', { email: 'a@a.com', password: 'x' })).rejects.toBeTruthy()
        expect(calls).toHaveLength(1)
        expect(calls.some((u) => u.includes('/refresh'))).toBe(false)
    })
})
