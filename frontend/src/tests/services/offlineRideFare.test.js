import { describe, expect, it } from 'vitest'
import { calculateOfflinePassengerFare, sumTrailMeters } from '@/shared/services/offlineRideFare'

describe('offlineRideFare', () => {
    it('soma só segmentos acima de 5 m', () => {
        const meters = sumTrailMeters([
            { lat: -20.0, lng: -41.0, capturedAt: 1 },
            { lat: -20.0, lng: -41.0, capturedAt: 2 },
            { lat: -20.01, lng: -41.0, capturedAt: 3 },
        ])
        expect(meters).toBeGreaterThan(1000)
    })

    it('calcula valor do passageiro com GPS local + km já sincronizados', () => {
        const fare = calculateOfflinePassengerFare({
            ride: {
                startedAt: Date.now() - 10 * 60 * 1000,
                actualDistance: 2000,
                fareRates: {
                    baseFare: 5,
                    perKm: 2,
                    perMinute: 0.5,
                    minimumFare: 7,
                    minDistanceIncludedKm: 0,
                    minTimeIncludedMin: 0,
                    roundingRule: 'none',
                    waitingActive: false,
                    globalTariffsTotal: 0,
                },
            },
            queuedPoints: [
                { lat: -20.0, lng: -41.0, capturedAt: 1 },
                { lat: -20.01, lng: -41.0, capturedAt: 2 },
            ],
            now: Date.now(),
        })
        expect(fare.offline).toBe(true)
        expect(fare.actualDistance).toBeGreaterThan(2000)
        expect(fare.amount).toBeGreaterThan(5)
        expect(fare.fareBreakdown.baseFare).toBe(5)
    })

    it('sem taxas congeladas não inventa preço', () => {
        expect(calculateOfflinePassengerFare({
            ride: { actualDistance: 5000 },
            queuedPoints: [],
        })).toBeNull()
    })
})
