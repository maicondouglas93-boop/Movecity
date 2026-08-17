import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withHardTimeout, CONNECTIVITY_TIMEOUT_MS } from '@/shared/utils/hardTimeout'

describe('teto de tempo de conectividade', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    // Regressão do travamento relatado em campo (2026-08-17): motorista finaliza sem
    // sinal e o botão fica girando pra sempre. O CapacitorHttp ignora o timeout do
    // axios, então a requisição nunca rejeita e o onError — onde mora o enfileiramento
    // offline — nunca roda. Fechando o app nesse estado, a corrida se perde.
    it('rejeita uma promise que nunca responde, marcando como falta de conectividade', async () => {
        const pendurada = new Promise(() => {}) // nunca resolve nem rejeita
        const corrida = withHardTimeout(pendurada, 12000)

        const assertion = expect(corrida).rejects.toMatchObject({ isConnectivityIssue: true })
        await vi.advanceTimersByTimeAsync(12000)
        await assertion
    })

    it('deixa passar a resposta quando ela chega antes do teto', async () => {
        const corrida = withHardTimeout(Promise.resolve({ data: 'ok' }), 12000)
        await expect(corrida).resolves.toEqual({ data: 'ok' })
    })

    it('preserva o erro original quando a requisição falha por conta própria', async () => {
        const original = new Error('Network Error')
        const corrida = withHardTimeout(Promise.reject(original), 12000)
        await expect(corrida).rejects.toBe(original)
    })

    // Sem isso, cada finalização deixaria um timer pendurado até estourar — no APK, que
    // fica aberto a corrida inteira, isso acumula.
    it('limpa o timer quando a promise resolve antes', async () => {
        const clear = vi.spyOn(globalThis, 'clearTimeout')
        await withHardTimeout(Promise.resolve('ok'), 12000)
        expect(clear).toHaveBeenCalled()
    })

    it('usa 12s como teto padrão', () => {
        expect(CONNECTIVITY_TIMEOUT_MS).toBe(12000)
    })
})
