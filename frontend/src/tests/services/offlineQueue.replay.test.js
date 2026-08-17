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
            orderBy: vi.fn(() => ({
                toArray: vi.fn(async () => [...state.actions].sort((a, b) => a.timestamp - b.timestamp)),
            })),
            delete: vi.fn(async (id) => { state.deleted.push(id) }),
            update: vi.fn(async (id, patch) => { state.updated.push({ id, patch }) }),
            add: vi.fn(),
        },
        failedActions: {
            add: vi.fn(async (entry) => { state.failed.push(entry) }),
        },
    },
}))

vi.mock('@/shared/services/session', () => ({ getAccessToken: vi.fn(() => 'token') }))

const api = vi.hoisted(() => vi.fn())
vi.mock('@/shared/services/axios', () => ({ default: api }))

import { replayOfflineActions } from '@/shared/services/offlineQueue'

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

    // A regra "4xx é definitivo" continua valendo pro resto: um PIN errado não vira
    // certo por insistir, e retentar 5 vezes só atrasaria as ações seguintes da fila.
    it('mantém 4xx como definitivo em ações que não representam trabalho executado', async () => {
        state.actions.push({ id: 2, type: 'start-ride', rideId: 'r2', timestamp: 1000, attempts: 0, payload: { rideId: 'r2', otp: '000000' } })
        api.mockRejectedValue(httpError(400, 'PIN inválido'))

        await replayOfflineActions({ socket: socketStub })

        expect(state.failed).toHaveLength(1)
        expect(state.failed[0].type).toBe('start-ride')
        expect(state.deleted).toEqual([2])
    })

    it('trata 409 como já aplicado e tira a ação da fila sem marcar falha', async () => {
        state.actions.push({ id: 3, type: 'end-ride', rideId: 'r3', timestamp: 1000, attempts: 0, payload: { rideId: 'r3' } })
        api.mockRejectedValue(httpError(409, 'Corrida já finalizada'))

        const applied = []
        await replayOfflineActions({ socket: socketStub, onAlreadyApplied: (a) => applied.push(a.type) })

        expect(state.failed).toHaveLength(0)
        expect(state.deleted).toEqual([3])
        expect(applied).toEqual(['end-ride'])
    })

    it('preserva o instante real do embarque ao reenviar start-ride', async () => {
        const boardedAt = 1755300000000
        state.actions.push({
            id: 4, type: 'start-ride', rideId: 'r4', timestamp: 1000, attempts: 0,
            payload: { rideId: 'r4', otp: '123456', occurredAt: boardedAt },
        })
        api.mockResolvedValue({ status: 200, data: {} })

        await replayOfflineActions({ socket: socketStub })

        expect(api).toHaveBeenCalledWith(expect.objectContaining({
            params: expect.objectContaining({ occurredAt: boardedAt }),
        }))
    })
})
