import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Corrida finalizada sem internet não pode "voltar a ativa" quando a conexão retorna.
 *
 * Relato de campo (2026-08-17): o motorista iniciou a corrida, desligou a internet,
 * finalizou tudo e, assim que religou, a corrida reapareceu em andamento.
 *
 * Causa: no MESMO evento 'online', o RideContext reconcilia com o servidor
 * (GET /rides/captain-current) e a fila offline começa o replay. O GET é um pedido
 * simples; o replay ainda precisa drenar o GPS antes de reenviar a finalização. O GET
 * chega primeiro, o servidor responde com a corrida ainda `started` (ele legitimamente
 * ainda não sabe) e a tela reabre uma corrida já encerrada — com o valor já cobrado do
 * passageiro em mãos.
 */

const state = vi.hoisted(() => ({ actions: [] }))

vi.mock('@/shared/services/db', () => ({
    db: {
        offlineActions: {
            toArray: vi.fn(async () => [...state.actions]),
            add: vi.fn(async (a) => { state.actions.push(a) }),
        },
        driverLocations: { orderBy: vi.fn(() => ({ toArray: vi.fn(async () => []) })) },
        failedActions: { add: vi.fn() },
    },
}))
vi.mock('@/shared/services/axios', () => ({ default: vi.fn() }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: vi.fn(() => 'token') }))

import { hasPendingFinalization } from '@/shared/services/offlineQueue'

describe('corrida finalizada offline não ressuscita', () => {
    beforeEach(() => {
        state.actions.length = 0
    })

    it('reconhece finalização pendente da corrida', async () => {
        state.actions.push({ id: 1, type: 'end-ride', rideId: 'ride-1', payload: {} })
        await expect(hasPendingFinalization('ride-1')).resolves.toBe(true)
    })

    it('não confunde com a finalização de outra corrida', async () => {
        state.actions.push({ id: 1, type: 'end-ride', rideId: 'ride-outra', payload: {} })
        await expect(hasPendingFinalization('ride-1')).resolves.toBe(false)
    })

    // Só a finalização encerra a corrida. Um pagamento pendente não significa que ela
    // acabou — bloquear a reconciliação nesse caso esconderia uma corrida real.
    it('pagamento pendente não conta como finalização', async () => {
        state.actions.push({ id: 1, type: 'confirm-payment', rideId: 'ride-1', payload: {} })
        await expect(hasPendingFinalization('ride-1')).resolves.toBe(false)
    })

    it('fila vazia libera a reconciliação normalmente', async () => {
        await expect(hasPendingFinalization('ride-1')).resolves.toBe(false)
    })

    it('sem id de corrida não bloqueia nada', async () => {
        state.actions.push({ id: 1, type: 'end-ride', rideId: 'ride-1', payload: {} })
        await expect(hasPendingFinalization(null)).resolves.toBe(false)
        await expect(hasPendingFinalization(undefined)).resolves.toBe(false)
    })

    // O _id vem da API como string, mas um chamador pode passar ObjectId/número. Uma
    // comparação estrita falharia em silêncio — e falhar em silêncio aqui significa
    // exatamente o bug de campo voltando.
    it('compara ids de tipos diferentes sem falhar em silêncio', async () => {
        state.actions.push({ id: 1, type: 'end-ride', rideId: 12345, payload: {} })
        await expect(hasPendingFinalization('12345')).resolves.toBe(true)
    })
})
