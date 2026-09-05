import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRideMeter } from '@/shared/hooks/useRideMeter'

const state = vi.hoisted(() => ({ points: [], read: vi.fn() }))
vi.mock('@/shared/services/db', () => ({
    db: {
        transaction: (_mode, _points, _tracking, callback) => callback(),
        rideTracking: { get: async () => null },
        driverLocations: { where: () => ({ equals: id => ({
            toArray: async () => (await state.read()).filter(point => point.rideId === id),
        }) }) },
    },
}))

const now = Date.parse('2026-09-05T15:00:00Z')
const ride = {
    _id: 'meter-ride', status: 'started', startedAt: now - 60000, actualDistance: 1000,
    liveFare: { amount: 8, calculatedAt: new Date(now).toISOString() },
    fareRates: { baseFare: 5, perKm: 2, perMinute: 1, minimumFare: 0, roundingRule: 'none' },
}
let socket, listeners
const tick = async (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('taxímetro sem conexão', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(now)
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
        state.points = []
        state.read.mockReset().mockImplementation(async () => state.points)
        listeners = new Map()
        socket = { connected: false, on: (event, fn) => listeners.set(event, fn), off: (event) => listeners.delete(event) }
    })
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

    it('continua contando minutos sem receber nenhum evento do servidor', async () => {
        const { result } = renderHook(() => useRideMeter(ride, socket))
        await tick()
        expect(result.current.amount).toBe(8)
        await tick(60000)
        expect(result.current.amount).toBe(9)
        expect(result.current.local).toBe(true)
    })
    it('conta o tempo mesmo parado, com zero quilômetros', async () => {
        const stationary = { ...ride, actualDistance: 0 }
        const { result } = renderHook(() => useRideMeter(stationary, socket))
        await tick(60000)
        expect(result.current.amount).toBe(7)
        expect(result.current.distance).toBe(0)
    })
    it('soma os pontos GPS guardados sem misturar outra corrida', async () => {
        const { result } = renderHook(() => useRideMeter(ride, socket))
        await tick()
        state.points = [
            { rideId: ride._id, lat: -20, lng: -41, capturedAt: now },
            { rideId: ride._id, lat: -20.001, lng: -41, capturedAt: now + 5000 },
            { rideId: 'outra', lat: -21, lng: -41, capturedAt: now + 6000 },
        ]
        await tick(6000)
        expect(result.current.distance).toBeGreaterThan(1100)
        expect(result.current.distance).toBeLessThan(1120)
        expect(result.current.amount).toBeGreaterThan(8)
    })
    it('continua local até uma confirmação nova e não soma quilômetros duas vezes ao reconectar', async () => {
        const { result } = renderHook(() => useRideMeter(ride, socket))
        await tick(60000)
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
        socket.connected = true
        await tick(1000)
        expect(result.current.local).toBe(true)
        await act(async () => listeners.get('captain-location-updated')({ rideId: ride._id, actualDistance: 1250, liveFare: { amount: 9.5 } }))
        await tick(1000)
        expect(result.current).toMatchObject({ amount: 9.5, distance: 1250, serverDistance: 1250, local: false })
    })
    it('assume o cálculo local quando a rede diz online mas o servidor não atualiza', async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
        socket.connected = true
        const { result } = renderHook(() => useRideMeter(ride, socket))
        await tick(11000)
        expect(result.current.local).toBe(true)
        expect(result.current.amount).toBeGreaterThan(8)
    })
    it('não inventa tarifa quando faltam as regras salvas', async () => {
        const incomplete = { ...ride, fareRates: null }
        const { result } = renderHook(() => useRideMeter(incomplete, socket))
        await tick(60000)
        expect(result.current).toMatchObject({ amount: 8, unavailable: true })
    })
    it('encerra o contador ao finalizar a corrida', async () => {
        const { result, rerender } = renderHook(({ trip }) => useRideMeter(trip, socket), { initialProps: { trip: ride } })
        await tick()
        rerender({ trip: { ...ride, status: 'finished' } })
        const reads = state.read.mock.calls.length
        await tick(60000)
        expect(state.read).toHaveBeenCalledTimes(reads)
        expect(result.current).toBeNull()
        expect(listeners.size).toBe(0)
    })
    it('durante replay mantém o trecho restante, sem cair para um preço parcial do servidor', async () => {
        const first = { lat: -20, lng: -41, capturedAt: now - 10000, rideId: ride._id }
        const second = { ...first, lat: -20.001, capturedAt: now - 5000 }
        const third = { ...first, lat: -20.002, capturedAt: now }
        state.points = [first, second, third]
        const { result } = renderHook(() => useRideMeter(ride, socket))
        await tick()
        const distance = result.current.distance
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
        socket.connected = true
        await act(async () => listeners.get('captain-location-updated')({ rideId: ride._id,
            actualDistance: 1111.1949, liveFare: { amount: 8.22 },
            trackingCheckpoint: { actualDistance: 1111.1949, lastLocation: { lat: second.lat, lng: second.lng }, lastLocationAt: second.capturedAt },
        }))
        await tick(1000)
        expect(result.current.local).toBe(true)
        expect(result.current.distance).toBeCloseTo(distance, 2)
        expect(result.current.amount).toBeGreaterThan(8.22)
    })
})
