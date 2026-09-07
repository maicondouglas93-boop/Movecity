import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/shared/services/db'
import { getOfflineFinishIssue, offlineFinishIssue } from '@/shared/services/offlineFinishValidation'

const now = Date.parse('2026-09-07T17:57:00Z')
const origin = { lat: -20, lng: -41 }
const ride = { _id: 'r1', source: 'driver_initiated', destinationPending: true,
    pickupCoordinates: origin, startedAt: new Date(now - 180000).toISOString(), actualDistance: 0 }
const payload = { finishTimestamp: now, finishLat: origin.lat, finishLng: origin.lng,
    finishAccuracy: 10, finishLocationTimestamp: now }
const checkpoint = { actualDistance: 0, lastLocation: origin, lastLocationAt: new Date(now - 60000).toISOString() }
const check = extra => offlineFinishIssue({ ride, payload, checkpoint, ...extra })

afterEach(async () => { await db.delete() })

describe('validação offline da finalização presencial', () => {
    it('reproduz teste parado: tempo e tarifa base não autorizam distância zero', () => {
        expect(check()).toMatchObject({ code: 'INSUFFICIENT_TRIP_DISTANCE' })
    })
    it.each([1, 49, 50])('rejeita %s metros registrados se ainda está junto da origem', meters => {
        expect(check({ checkpoint: { ...checkpoint, actualDistance: meters } })).toMatchObject({ code: 'INSUFFICIENT_TRIP_DISTANCE' })
    })
    it('permite percurso registrado acima de 50 metros, mesmo retornando à origem', () => {
        expect(check({ checkpoint: { ...checkpoint, actualDistance: 51 } })).toBeNull()
    })
    it('conta GPS pendente de ida e volta antes de validar, sem exigir internet', () => {
        expect(check({ queuedPoints: [
            { lat: -20.001, lng: -41, capturedAt: now - 30000, accuracy: 10 },
            { ...origin, capturedAt: now - 1000, accuracy: 10 },
        ] })).toBeNull()
    })
    it('inclui o GPS do toque como no servidor, sem exigir que o próximo tick tenha ocorrido', () => {
        expect(check({ payload: { ...payload, finishLat: -20.001 } })).toBeNull()
    })
    it('ruído de GPS de poucos metros não vira uma viagem', () => {
        expect(check({ payload: { ...payload, finishLat: -20.0001 } })).toMatchObject({ code: 'INSUFFICIENT_TRIP_DISTANCE' })
    })
    it('não aceita salto impossível, ponto futuro ou impreciso para liberar teste parado', () => {
        expect(check({ queuedPoints: [
            { lat: -21, lng: -41, capturedAt: now - 1000, accuracy: 10 },
            { lat: -20.001, lng: -41, capturedAt: now + 1000, accuracy: 10 },
            { lat: -20.001, lng: -41, capturedAt: now - 1000, accuracy: 200 },
        ] })).toMatchObject({ code: 'INSUFFICIENT_TRIP_DISTANCE' })
    })
    it('sem GPS válido não promete finalização', () => {
        expect(check({ checkpoint: null, payload: { finishTimestamp: now } })).toMatchObject({ code: 'INVALID_FINISH_LOCATION' })
    })
    it('GPS antigo é comparado com o instante original do toque', () => {
        expect(check({ checkpoint: { ...checkpoint, lastLocationAt: new Date(now - 121000).toISOString() },
            payload: { finishTimestamp: now } })).toMatchObject({ code: 'STALE_FINISH_LOCATION' })
    })
    it('não aplica a regra presencial a corrida com destino previamente definido', () => {
        expect(check({ ride: { ...ride, destinationPending: false, destination: 'Rua B' } })).toBeNull()
    })
    it('lê distância já confirmada no banco local após ACK, mesmo com snapshot desatualizado', async () => {
        await db.open()
        await db.rideTracking.put({ ...checkpoint, actualDistance: 800, rideId: 'r1' })
        expect(await getOfflineFinishIssue(ride, payload)).toBeNull()
        expect(await db.offlineActions.count()).toBe(0)
    })
})
