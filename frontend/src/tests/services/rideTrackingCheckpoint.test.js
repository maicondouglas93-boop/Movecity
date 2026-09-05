import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/shared/services/db'
import { acknowledgeTrackingPoint, readTrackingState } from '@/shared/services/rideTrackingCheckpoint'
import { buildOfflineFinishPreview } from '@/shared/services/offlineRideFare'
import { flushQueuedLocations } from '@/shared/services/offlineQueue'

vi.mock('@/shared/services/axios', () => ({ default: vi.fn() }))
const now = Date.now()
const A = { lat: -20, lng: -41 }, B = { lat: -20.001, lng: -41 }, C = { lat: -20.002, lng: -41 }
const anchor = { actualDistance: 1000, lastLocation: A, lastLocationAt: now - 30000 }
const confirmedB = { actualDistance: 1111.1949, lastLocation: B, lastLocationAt: now - 20000 }
const ride = { _id: 'trip', status: 'started', startedAt: now - 600000,
    actualDistance: 1000, trackingCheckpoint: anchor, fareRates: { baseFare: 5, perKm: 2 } }
const point = (pointId, coords, capturedAt, extra = {}) => ({ pointId, rideId: 'trip', ...coords, capturedAt, accuracy: 10, ...extra })
async function insert(value) { return { ...value, id: await db.driverLocations.add(value) } }

describe('checkpoint GPS durável com IndexedDB', () => {
    beforeEach(async () => { await db.delete(); await db.open() })
    afterAll(async () => { await db.delete() })

    it('migra v3 preservando pontos e finalizações existentes', async () => {
        await db.delete()
        const old = new Dexie('MoveCityDB')
        old.version(3).stores({ offlineActions: '++id, type, rideId, timestamp, attempts',
            driverLocations: '++id, &pointId, rideId, capturedAt, queuedAt',
            failedActions: '++id, type, rideId, timestamp, failedAt' })
        await old.driverLocations.add(point('legacy', B, now - 20000))
        await old.offlineActions.add({ type: 'end-ride', rideId: 'trip', timestamp: now })
        old.close()
        await db.open()
        expect(await db.driverLocations.count()).toBe(1)
        expect(await db.offlineActions.count()).toBe(1)
        expect(await db.rideTracking.count()).toBe(0)
    })
    it('inclui o trecho até o primeiro ponto offline', async () => {
        await insert(point('b', B, now - 20000))
        expect((await buildOfflineFinishPreview(ride, now)).actualDistance).toBeCloseTo(1111.1949, 2)
    })
    it('ACK perdido: snapshot novo e fila antiga não contam novamente o ponto aceito', async () => {
        await insert(point('b', B, now - 20000)); await insert(point('c', C, now - 10000))
        const value = await buildOfflineFinishPreview({ ...ride, trackingCheckpoint: confirmedB }, now)
        expect(value.actualDistance).toBeCloseTo(1222.3898, 2)
    })
    it('reabertura após ACK mantém a distância confirmada e a fila restante', async () => {
        const b = await insert(point('b', B, now - 20000))
        await insert(point('c', C, now - 10000))
        await acknowledgeTrackingPoint(b, { pointId: 'b', trackingCheckpoint: confirmedB })
        db.close(); await db.open()
        expect(await db.driverLocations.count()).toBe(1)
        const value = await buildOfflineFinishPreview(ride, now)
        expect(value.syncedDistance).toBe(1111.1949)
        expect(value.actualDistance).toBeCloseTo(1222.3898, 2)
    })
    it('falha ao remover aborta também o checkpoint: nenhum meio-estado é salvo', async () => {
        const b = await insert(point('b', B, now - 20000))
        const failingDelete = vi.spyOn(db.driverLocations, 'delete').mockRejectedValueOnce(new Error('disk failure'))
        await expect(acknowledgeTrackingPoint(b, { pointId: 'b', trackingCheckpoint: confirmedB })).rejects.toThrow('disk failure')
        failingDelete.mockRestore()
        expect(await db.driverLocations.count()).toBe(1)
        expect(await db.rideTracking.count()).toBe(0)
    })
    it('ACK de outro ponto preserva o registro e interrompe o replay', async () => {
        await insert(point('b', B, now - 20000))
        const socket = { connected: true, emit: (_event, _payload, ack) => ack({ ok: true, pointId: 'wrong' }) }
        await expect(flushQueuedLocations(socket)).rejects.toThrow('outro ponto')
        expect(await db.driverLocations.count()).toBe(1)
    })
    it('ACK rejeitado usa a âncora do servidor, nunca o ponto GPS inválido', async () => {
        const bad = await insert(point('bad', { lat: 40, lng: 20 }, now - 20000))
        await insert(point('c', C, now - 10000))
        await acknowledgeTrackingPoint(bad, { accepted: false, pointId: 'bad', trackingCheckpoint: anchor })
        expect((await buildOfflineFinishPreview(ride, now)).actualDistance).toBeCloseTo(1222.3898, 2)
    })
    it('ignora checkpoint tardio, de menor distância ou timestamp', async () => {
        const newer = { rideId: 'trip', actualDistance: 1222, lastLocation: C, lastLocationAt: now - 10000 }
        await db.rideTracking.put(newer)
        const b = await insert(point('b', B, now - 20000))
        await acknowledgeTrackingPoint(b, { pointId: 'b', trackingCheckpoint: anchor })
        expect((await readTrackingState(ride)).checkpoint).toEqual(newer)
    })
    it('não usa outlier, GPS impreciso, outro trajeto nem ponto após finalizar', async () => {
        await db.driverLocations.bulkAdd([
            point('bad', { lat: 40, lng: 20 }, now - 25000),
            point('inaccurate', C, now - 24000, { accuracy: 200 }), point('b', B, now - 20000),
            point('other', C, now - 15000, { rideId: 'other' }), point('after-finish', C, now + 1000),
        ])
        expect((await buildOfflineFinishPreview(ride, now)).actualDistance).toBeCloseTo(1111.1949, 2)
    })
})
