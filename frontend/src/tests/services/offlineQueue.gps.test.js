import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
    points: [],
    deletePoint: vi.fn(),
    putPoint: vi.fn(),
}))

state.putPoint.mockImplementation(async (point) => {
    const existing = state.points.findIndex(item => item.pointId === point.pointId)
    const stored = { ...point, id: existing >= 0 ? state.points[existing].id : state.points.length + 1 }
    if (existing >= 0) state.points[existing] = stored
    else state.points.push(stored)
    return stored.id
})

vi.mock('@/shared/services/db', () => ({
    db: {
        driverLocations: {
            put: state.putPoint,
            add: vi.fn(),
            delete: state.deletePoint,
            orderBy: vi.fn(() => ({
                toArray: vi.fn(async () => [...state.points].sort((a, b) => a.capturedAt - b.capturedAt)),
            })),
        },
        offlineActions: {},
        failedActions: {},
    },
}))

vi.mock('@/shared/services/axios', () => ({ default: vi.fn() }))
vi.mock('@/shared/services/session', () => ({ getAccessToken: vi.fn(() => 'token') }))

import { flushQueuedLocations } from '@/shared/services/offlineQueue'
import { emitCaptainLocation } from '@/shared/services/captainLocationSync'

describe('fila GPS offline P0', () => {
    beforeEach(() => {
        state.points.length = 0
        state.deletePoint.mockClear()
        state.putPoint.mockClear()
    })

    it('persiste todos os pontos da corrida, inclusive com o socket offline', async () => {
        const base = { socket: { connected: false }, captainId: 'cap1', rideId: 'ride1' }

        await emitCaptainLocation({ ...base, location: { lat: -19.55, lng: -41.68, timestamp: 1000 } })
        await emitCaptainLocation({ ...base, location: { lat: -19.70, lng: -41.80, timestamp: 2000 } })
        await emitCaptainLocation({ ...base, location: { lat: -19.55, lng: -41.68, timestamp: 3000 } })

        expect(state.points).toHaveLength(3)
        expect(state.points.map(point => point.capturedAt)).toEqual([1000, 2000, 3000])
        expect(state.points.every(point => point.rideId === 'ride1')).toBe(true)
    })

    it('sincroniza em ordem e só remove cada ponto depois do ack', async () => {
        state.points.push(
            { id: 3, pointId: 'p3', rideId: 'ride1', lat: 3, lng: 3, capturedAt: 3000 },
            { id: 1, pointId: 'p1', rideId: 'ride1', lat: 1, lng: 1, capturedAt: 1000 },
            { id: 2, pointId: 'p2', rideId: 'ride1', lat: 2, lng: 2, capturedAt: 2000 },
        )
        const emitted = []
        const socket = {
            connected: true,
            emit: vi.fn((event, payload, ack) => {
                emitted.push(payload.pointId)
                ack({ ok: true, pointId: payload.pointId })
            }),
        }

        await flushQueuedLocations(socket, { rideId: 'ride1' })

        expect(emitted).toEqual(['p1', 'p2', 'p3'])
        expect(state.deletePoint.mock.calls.map(([id]) => id)).toEqual([1, 2, 3])
    })

    it('retoma após reinício usando os pontos que já estavam persistidos', async () => {
        // A fila já existe antes de qualquer chamada ao serviço nesta execução, como
        // aconteceria quando o IndexedDB é reaberto após reiniciar o aplicativo.
        state.points.push(
            { id: 2, pointId: 'persisted-2', rideId: 'ride1', lat: 2, lng: 2, capturedAt: 2000 },
            { id: 1, pointId: 'persisted-1', rideId: 'ride1', lat: 1, lng: 1, capturedAt: 1000 },
        )
        const emitted = []
        const socket = {
            connected: true,
            emit: vi.fn((_event, payload, ack) => {
                emitted.push(payload.pointId)
                ack({ ok: true, pointId: payload.pointId })
            }),
        }

        await flushQueuedLocations(socket, { rideId: 'ride1' })

        expect(emitted).toEqual(['persisted-1', 'persisted-2'])
        expect(state.deletePoint.mock.calls.map(([id]) => id)).toEqual([1, 2])
    })

    it('mantém o ponto e interrompe a fila quando o backend não confirma', async () => {
        state.points.push(
            { id: 1, pointId: 'p1', rideId: 'ride1', lat: 1, lng: 1, capturedAt: 1000 },
            { id: 2, pointId: 'p2', rideId: 'ride1', lat: 2, lng: 2, capturedAt: 2000 },
        )
        const socket = {
            connected: true,
            emit: vi.fn((event, payload, ack) => ack({ ok: false, code: 'TRACKING_CONFLICT' })),
        }

        await expect(flushQueuedLocations(socket, { rideId: 'ride1' })).rejects.toThrow('TRACKING_CONFLICT')
        expect(state.deletePoint).not.toHaveBeenCalled()
    })
})
