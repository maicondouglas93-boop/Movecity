// @vitest-environment-options {"url":"https://localhost/driver.html"}
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import api from '@/shared/services/axios'
import { loginCaptainReliably } from '@/shared/services/loginReadiness'

vi.mock('@/shared/services/swCommunication', () => ({
    syncTokenWithSW: vi.fn(),
    clearTokenInSW: vi.fn(),
}))

const require = createRequire(import.meta.url)
const { csrfProtection } = require('../../../../Backend/middlewares/csrfProtection.middleware.js')
const originalAdapter = api.defaults.adapter

// Simula o cookie que a camada HTTP nativa anexa mesmo depois de o token local
// desaparecer. A validação usa o middleware real que produz o erro da tela.
function cookieAdapter(config) {
    const response = { status: 200, data: {}, headers: {}, config }
    const req = {
        method: config.method,
        cookies: { token: 'old-cookie', refreshToken: 'old-refresh-cookie' },
        get: name => config.headers.get(name),
    }
    const res = {
        status(code) { response.status = code; return this },
        json(data) { response.data = data; return this },
    }
    csrfProtection(req, res, () => { response.data = { reachedRoute: true } })
    if (response.status !== 200) {
        const error = new Error(response.data.message)
        error.config = config
        error.response = response
        return Promise.reject(error)
    }
    return Promise.resolve(response)
}

describe('origem das requisições nativas com cookie de sessão', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.stubGlobal('Capacitor', { isNativePlatform: () => true })
        api.defaults.adapter = vi.fn(cookieAdapter)
    })

    afterEach(() => {
        api.defaults.adapter = originalAdapter
        vi.unstubAllGlobals()
        localStorage.clear()
    })

    it('login do motorista passa pelo CSRF com cookie antigo e sem Bearer', async () => {
        const credentials = { email: 'driver@example.com', password: 'test-password' }
        const response = await loginCaptainReliably(credentials)

        expect(response.data.reachedRoute).toBe(true)
        expect(api.defaults.adapter.mock.calls.map(([config]) => config.url))
            .toEqual(['/api/ready', '/captains/login'])
        expect(response.config.headers.get('Origin')).toBe('https://localhost')
        expect(response.config.headers.get('Authorization')).toBeUndefined()
        expect(JSON.parse(response.config.data)).toEqual(credentials)
    })

    it.each(['/captains/register', '/captains/refresh', '/users/login', '/users/refresh'])(
        '%s também envia a origem nativa sem depender de access token', async endpoint => {
            const response = await api.post(endpoint, {})
            expect(response.data.reachedRoute).toBe(true)
            expect(response.config.headers.get('Origin')).toBe('https://localhost')
            expect(response.config.headers.get('Authorization')).toBeUndefined()
        },
    )

    it('mantém a origem nativa e o Bearer explícito do chamador', async () => {
        const response = await api.post('/captains/logout', {}, {
            headers: { Authorization: 'Bearer explicit-token' },
        })
        expect(response.config.headers.get('Authorization')).toBe('Bearer explicit-token')
        expect(response.config.headers.get('Origin')).toBe('https://localhost')
    })

    it('web continua rejeitando cookie sem Origin ou Referer', async () => {
        vi.stubGlobal('Capacitor', { isNativePlatform: () => false })
        await expect(api.post('/captains/login', {})).rejects.toMatchObject({
            response: { status: 403, data: { code: 'CSRF_ORIGIN_REQUIRED' } },
        })
        expect(api.defaults.adapter.mock.calls[0][0].headers.has('Origin')).toBe(false)
    })

    it('web preserva a origem enviada pelo navegador e rejeita origem maliciosa', async () => {
        vi.stubGlobal('Capacitor', { isNativePlatform: () => false })
        await expect(api.post('/captains/login', {}, {
            headers: { Origin: 'https://evil.example' },
        })).rejects.toMatchObject({
            response: { status: 403, data: { code: 'CSRF_ORIGIN_REJECTED' } },
        })
    })

    it('web continua aceitando a origem autorizada enviada pelo navegador', async () => {
        vi.stubGlobal('Capacitor', { isNativePlatform: () => false })
        const response = await api.post('/captains/login', {}, {
            headers: { Origin: 'https://moovecity.com.br' },
        })
        expect(response.data.reachedRoute).toBe(true)
        expect(response.config.headers.get('Origin')).toBe('https://moovecity.com.br')
    })
})
