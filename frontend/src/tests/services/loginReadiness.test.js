import { afterEach, describe, expect, it, vi } from 'vitest'
import { loginCaptainReliably } from '@/shared/services/loginReadiness'

describe('login resiliente do motorista', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  it('aquece o backend antes de enviar as credenciais', async () => {
    const response = { status: 200, data: { token: 'token' } }
    const client = {
      get: vi.fn().mockResolvedValue({ status: 200 }),
      post: vi.fn().mockResolvedValue(response),
    }
    const stages = []

    const result = await loginCaptainReliably(
      { email: 'motorista@example.com', password: 'senha123' },
      { client, onStage: (stage) => stages.push(stage) },
    )

    expect(client.get).toHaveBeenCalledWith('/api/ready', { timeout: 30_000 })
    expect(client.post).toHaveBeenCalledWith(
      '/captains/login',
      { email: 'motorista@example.com', password: 'senha123' },
      { timeout: 30_000 },
    )
    expect(stages).toEqual(['Conectando ao servidor...', 'Verificando acesso...'])
    expect(result).toBe(response)
  })

  it('continua para o login se o wake-up falhar, sem duplicar o POST', async () => {
    const client = {
      get: vi.fn().mockRejectedValue(new Error('cold start')),
      post: vi.fn().mockResolvedValue({ status: 200 }),
    }

    await loginCaptainReliably(
      { email: 'motorista@example.com', password: 'senha123' },
      { client },
    )

    expect(client.post).toHaveBeenCalledTimes(1)
  })

  it('falha imediatamente quando o aparelho está offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const client = { get: vi.fn(), post: vi.fn() }

    await expect(loginCaptainReliably({}, { client })).rejects.toMatchObject({
      friendlyMessage: expect.stringMatching(/Sem internet/),
    })
    expect(client.get).not.toHaveBeenCalled()
    expect(client.post).not.toHaveBeenCalled()
  })
})
