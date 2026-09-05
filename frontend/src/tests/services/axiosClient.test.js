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

vi.mock('@/shared/platform/nativeSession.service', () => ({
    syncNativeCaptainSession: vi.fn(),
    clearNativeCaptainSession: vi.fn(),
}))

const { default: api, refreshAccessToken } = await import('@/shared/services/axios')

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
    })

    afterEach(() => {
        api.defaults.adapter = originalAdapter
        vi.useRealTimers()
    })

    it('tem timeout de 10s e withCredentials habilitado', () => {
        expect(api.defaults.timeout).toBe(10000)
        expect(api.defaults.withCredentials).toBe(true)
    })

    it('injeta o token da sessão certa quando o chamador não passa Authorization', async () => {
        localStorage.setItem('token', 'user-token')
        const adapter = vi.fn(async (config) => okResponse(config))
        api.defaults.adapter = adapter

        await api.get('/users/profile')

        expect(authHeaderOf(adapter.mock.calls[0][0])).toBe('Bearer user-token')
    })

    it('respeita Authorization explícito — não sobrescreve com o fallback user>captain (sessão dupla)', async () => {
        // Cenário real: motorista e passageiro logados no mesmo navegador; a rota
        // /wallet não é classificável por sessionKindForUrl e o fallback preferiria
        // o token de USER. O header explícito do chamador tem que vencer.
        localStorage.setItem('token', 'user-token')
        localStorage.setItem('captain-token', 'captain-token')
        const adapter = vi.fn(async (config) => okResponse(config))
        api.defaults.adapter = adapter

        await api.get('/wallet/transactions', {
            headers: { Authorization: 'Bearer captain-token' },
        })

        expect(authHeaderOf(adapter.mock.calls[0][0])).toBe('Bearer captain-token')
    })

    it('401 dispara UM refresh e repete a requisição original com o token novo', async () => {
        localStorage.setItem('token', 'token-vencido')
        localStorage.setItem('refreshToken', 'refresh-valido')

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
        expect(localStorage.getItem('token')).toBe('token-novo')
    })

    it('erro de rede (sem resposta HTTP) NÃO desloga e devolve friendlyMessage', async () => {
        localStorage.setItem('token', 'user-token')
        api.defaults.adapter = vi.fn(async (config) => {
            throw networkError(config)
        })

        await expect(api.get('/users/profile')).rejects.toMatchObject({
            friendlyMessage: expect.any(String),
        })
        // A sessão sobrevive à instabilidade de rede — era o bug antigo.
        expect(localStorage.getItem('token')).toBe('user-token')
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

    it.each([undefined, 500, 503, 429])('preserva a sessão e propaga a falha temporária %s do refresh, não o 401 original', async (status) => {
        localStorage.setItem('token', 'vencido')
        localStorage.setItem('refreshToken', 'refresh-valido')
        let refreshFailure
        api.defaults.adapter = vi.fn(async (config) => {
            if (config.url === '/users/refresh') {
                refreshFailure = networkError(config)
                if (status) refreshFailure.response = { status, data: {} }
                throw refreshFailure
            }
            throw http401(config)
        })
        const caught = await api.get('/users/profile').catch(error => error)
        expect(caught).toBe(refreshFailure)
        expect(localStorage.getItem('token')).toBe('vencido')
        expect(localStorage.getItem('refreshToken')).toBe('refresh-valido')
        api.defaults.adapter = async config => okResponse(config, { token: 'recuperado' })
        await expect(refreshAccessToken('user')).resolves.toBe('recuperado')
    })

    it('renovação concorrente da mesma conta compartilha uma única chamada', async () => {
        const adapter = vi.fn(async config => okResponse(config, { token: 'novo' }))
        api.defaults.adapter = adapter
        await expect(Promise.all([refreshAccessToken('user'), refreshAccessToken('user')])).resolves.toEqual(['novo', 'novo'])
        expect(adapter).toHaveBeenCalledOnce()
    })

    it('renova passageiro e motorista simultaneamente sem misturar os tokens', async () => {
        api.defaults.adapter = vi.fn(async config => okResponse(config, {
            token: config.url === '/users/refresh' ? 'user-novo' : 'captain-novo',
        }))
        await expect(Promise.all([refreshAccessToken('user'), refreshAccessToken('captain')])).resolves.toEqual(['user-novo', 'captain-novo'])
        expect(localStorage.getItem('token')).toBe('user-novo')
        expect(localStorage.getItem('captain-token')).toBe('captain-novo')
        expect(api.defaults.adapter).toHaveBeenCalledTimes(2)
    })

    it('timeout nativo não prende a fila de refresh nem apaga a sessão', async () => {
        vi.useFakeTimers()
        localStorage.setItem('token', 'vencido')
        api.defaults.adapter = () => new Promise(() => {})
        const result = refreshAccessToken('user').catch(error => error)
        await vi.advanceTimersByTimeAsync(12000)
        expect(await result).toMatchObject({ isConnectivityIssue: true })
        expect(localStorage.getItem('token')).toBe('vencido')
        api.defaults.adapter = async config => okResponse(config, { token: 'recuperado' })
        await expect(refreshAccessToken('user')).resolves.toBe('recuperado')
    })

    it('refresh realmente inválido encerra apenas a conta afetada', async () => {
        localStorage.setItem('token', 'vencido')
        localStorage.setItem('refreshToken', 'revogado')
        localStorage.setItem('captain-token', 'captain-valido')
        api.defaults.adapter = async config => { throw http401(config) }
        await expect(refreshAccessToken('user')).rejects.toMatchObject({ response: { status: 401 } })
        expect(localStorage.getItem('token')).toBeNull()
        expect(localStorage.getItem('refreshToken')).toBeNull()
        expect(localStorage.getItem('captain-token')).toBe('captain-valido')
    })
})
