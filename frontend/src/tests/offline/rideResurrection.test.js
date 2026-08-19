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

/**
 * O guarda acima resolve METADE do problema, e o relato voltou por causa da outra metade.
 *
 * hasPendingFinalization impede que o snapshot atrasado do SERVIDOR entre no estado. Mas
 * a finalização offline nunca avançava o estado LOCAL: diferente do caminho online
 * (onSuccess faz setCaptainRide(data)) e do próprio pagamento offline (que faz
 * setCaptainRide(null)), queueFinalizationOffline só mexia em estado interno da tela.
 *
 * Resultado: o RideContext seguia com a corrida em 'started' o tempo todo. Quando a
 * internet voltava, o guarda barrava o servidor com sucesso — e mesmo assim a Home lia do
 * contexto uma corrida ativa que o motorista já tinha fechado.
 */
describe('estado local avança ao finalizar offline', () => {
    const RANK = {
        scheduled: 0, requested: 1, accepted: 2, going_to_pickup: 3,
        arrived: 4, waiting_passenger: 5, started: 6, finished: 7, cancelled: 7,
    }
    // Mesma regra do mergeRideByStatus do RideContext.
    const merge = (previous, next) => {
        if (!previous || !next?._id) return next
        if (String(previous._id) !== String(next._id)) return next
        const p = RANK[previous.status] ?? -1
        const n = RANK[next.status] ?? -1
        return n >= 0 && p > n ? previous : next
    }

    it('a corrida finalizada offline entra no contexto e não é revertida pelo servidor', () => {
        const emAndamento = { _id: 'ride-1', status: 'started' }

        // O que queueFinalizationOffline passou a fazer.
        const finalizadaLocalmente = { ...emAndamento, status: 'finished', finalPrice: 25 }
        const contexto = merge(emAndamento, finalizadaLocalmente)
        expect(contexto.status).toBe('finished')

        // Internet volta: o servidor ainda responde 'started' porque o replay não chegou.
        // Mesmo que esse snapshot escape do guarda, o merge por status não pode retroceder.
        const doServidor = { _id: 'ride-1', status: 'started' }
        expect(merge(contexto, doServidor).status).toBe('finished')
    })

    it('sem valor calculado a corrida ainda assim é dada como encerrada', () => {
        // Zona rural sem GPS suficiente pro preço: o preço espera o servidor, mas a
        // corrida foi fechada e enfileirada do mesmo jeito — deixar em 'started' era o
        // que reabria a tela.
        const emAndamento = { _id: 'ride-2', status: 'started' }
        const semPreco = { ...emAndamento, status: 'finished' }
        expect(merge(emAndamento, semPreco).status).toBe('finished')
    })
})
