import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fila de AÇÕES offline (distinta de offlineQueue.gps.test.js, que cobre a fila de
// pontos GPS). Aqui interessa o que acontece com uma ação já executada de verdade pelo
// motorista quando o servidor responde erro na hora de sincronizar.
const state = vi.hoisted(() => ({
    actions: [],
    failed: [],
    deleted: [],
    updated: [],
}))

vi.mock('@/shared/services/db', () => ({
    db: {
        driverLocations: {
            orderBy: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
            delete: vi.fn(),
            put: vi.fn(),
            add: vi.fn(),
        },
        offlineActions: {
            toArray: vi.fn(async () => [...state.actions]),
            orderBy: vi.fn(() => ({
                toArray: vi.fn(async () => [...state.actions].sort((a, b) => a.timestamp - b.timestamp)),
            })),
            delete: vi.fn(async (id) => { state.deleted.push(id) }),
            update: vi.fn(async (id, patch) => {
                state.updated.push({ id, patch })
                const item = state.actions.find(action => action.id === id)
                if (item) Object.assign(item, patch)
            }),
            add: vi.fn(async (entry) => {
                const id = Math.max(0, ...state.actions.map(action => action.id || 0)) + 1
                state.actions.push({ ...entry, id })
                return id
            }),
        },
        failedActions: {
            add: vi.fn(async (entry) => { state.failed.push(entry) }),
        },
    },
}))

vi.mock('@/shared/services/session', () => ({ getAccessToken: vi.fn(() => 'token') }))

const api = vi.hoisted(() => vi.fn())
vi.mock('@/shared/services/axios', () => ({ default: api }))

import { enqueueOfflineAction, replayOfflineActions } from '@/shared/services/offlineQueue'

function httpError(status, message = 'erro') {
    const err = new Error(message)
    err.response = { status, data: { message } }
    return err
}

const socketStub = { connected: true, emit: vi.fn() }

describe('replay da fila de ações offline', () => {
    beforeEach(() => {
        state.actions.length = 0
        state.failed.length = 0
        state.deleted.length = 0
        state.updated.length = 0
        api.mockReset()
    })

    // Achado 01 da auditoria de corrida ativa (2026-08-16): a corrida foi feita, o
    // motorista finalizou sem sinal e um único 400 na sincronização apagava a ação pra
    // sempre — corrida presa em `started`, viagem nunca paga.
    it('não descarta a finalização de uma corrida já executada num erro 400', async () => {
        state.actions.push({ id: 1, type: 'end-ride', rideId: 'r1', timestamp: 1000, attempts: 0, payload: { rideId: 'r1' } })
        api.mockRejectedValue(httpError(400, 'Localização desatualizada.'))

        const retried = []
        await replayOfflineActions({ socket: socketStub, onRetryLater: (a) => retried.push(a.type) })

        expect(state.failed).toHaveLength(0)
        expect(state.deleted).toHaveLength(0)
        expect(state.updated).toEqual([{ id: 1, patch: { attempts: 1 } }])
        expect(retried).toEqual(['end-ride'])
    })

    it('desiste da finalização quando a corrida não existe mais (404)', async () => {
        state.actions.push({ id: 1, type: 'end-ride', rideId: 'r1', timestamp: 1000, attempts: 0, payload: { rideId: 'r1' } })
        api.mockRejectedValue(httpError(404, 'Corrida não encontrada'))

        await replayOfflineActions({ socket: socketStub })

        expect(state.failed).toHaveLength(1)
        expect(state.deleted).toEqual([1])
    })

    // A regra "4xx é definitivo" continua valendo para ações não executadas.
    it('mantém 4xx como definitivo em ações que não representam trabalho executado', async () => {
        state.actions.push({ id: 2, type: 'start-ride', rideId: 'r2', timestamp: 1000, attempts: 0, payload: { rideId: 'r2' } })
        api.mockRejectedValue(httpError(400, 'Corrida inválida'))

        await replayOfflineActions({ socket: socketStub })

        expect(state.failed).toHaveLength(1)
        expect(state.failed[0].type).toBe('start-ride')
        expect(state.deleted).toEqual([2])
    })

    it('mantém finalização em 409 porque ela ainda pode estar em processamento', async () => {
        state.actions.push({ id: 3, type: 'end-ride', rideId: 'r3', timestamp: 1000, attempts: 0, payload: { rideId: 'r3' } })
        api.mockRejectedValue(httpError(409, 'Finalização em processamento'))

        const retried = []
        await replayOfflineActions({ socket: socketStub, onRetryLater: (a) => retried.push(a.type) })

        expect(state.failed).toHaveLength(0)
        expect(state.deleted).toHaveLength(0)
        expect(state.updated).toEqual([{ id: 3, patch: { attempts: 1 } }])
        expect(retried).toEqual(['end-ride'])
    })

    it('trata 409 das demais ações como já aplicado', async () => {
        state.actions.push({ id: 5, type: 'start-ride', rideId: 'r5', timestamp: 1000, attempts: 0, payload: { rideId: 'r5' } })
        api.mockRejectedValue(httpError(409, 'Corrida já iniciada'))

        const applied = []
        await replayOfflineActions({ socket: socketStub, onAlreadyApplied: (a) => applied.push(a.type) })

        expect(state.failed).toHaveLength(0)
        expect(state.deleted).toEqual([5])
        expect(applied).toEqual(['start-ride'])
    })

    it('nunca abandona uma finalização após cinco tentativas transitórias', async () => {
        state.actions.push({ id: 6, type: 'end-ride', rideId: 'r6', timestamp: 1000, attempts: 4, payload: { rideId: 'r6' } })
        api.mockRejectedValue(httpError(503, 'Servidor indisponível'))

        await replayOfflineActions({ socket: socketStub })

        expect(state.failed).toHaveLength(0)
        expect(state.deleted).toHaveLength(0)
        expect(state.updated).toEqual([{ id: 6, patch: { attempts: 5 } }])
    })

    it('deduplica dois pedidos de finalização da mesma corrida', async () => {
        await Promise.all([
            enqueueOfflineAction({
                type: 'end-ride',
                rideId: 'r7',
                payload: { rideId: 'r7', finishTimestamp: 2000 },
            }),
            enqueueOfflineAction({
                type: 'end-ride',
                rideId: 'r7',
                payload: { rideId: 'r7', finishTimestamp: 2500, finishLat: -20.1, finishLng: -41.6 },
            }),
        ])

        const finalizations = state.actions.filter(action => action.type === 'end-ride' && action.rideId === 'r7')
        expect(finalizations).toHaveLength(1)
        expect(finalizations[0].payload).toEqual(expect.objectContaining({
            finishTimestamp: 2000,
            finishLat: -20.1,
            finishLng: -41.6,
        }))
    })

    it('preserva o instante real do embarque ao reenviar start-ride', async () => {
        const boardedAt = 1755300000000
        state.actions.push({
            id: 4, type: 'start-ride', rideId: 'r4', timestamp: 1000, attempts: 0,
            payload: { rideId: 'r4', occurredAt: boardedAt },
        })
        api.mockResolvedValue({ status: 200, data: {} })

        await replayOfflineActions({ socket: socketStub })

        expect(api).toHaveBeenCalledWith(expect.objectContaining({
            params: expect.objectContaining({ occurredAt: boardedAt }),
        }))
    })
})
