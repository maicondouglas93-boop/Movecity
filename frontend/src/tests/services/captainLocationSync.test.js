import { describe, expect, it } from 'vitest'
import {
    LOCATION_INTERVAL_ACTIVE_MS,
    LOCATION_INTERVAL_ONLINE_MS,
    hasActiveService,
    resolveLocationIntervalMs,
    resolveServiceKind,
} from '@/shared/services/captainLocationSync'

describe('captainLocationSync', () => {
    it('ONLINE sem serviço usa intervalo moderado', () => {
        expect(resolveLocationIntervalMs({ isOnline: true, hasActiveTrip: false }))
            .toBe(LOCATION_INTERVAL_ONLINE_MS)
    })

    it('serviço ativo usa intervalo alto (inclui presencial pós-GO)', () => {
        expect(resolveLocationIntervalMs({ isOnline: false, hasActiveTrip: true }))
            .toBe(LOCATION_INTERVAL_ACTIVE_MS)
        expect(resolveLocationIntervalMs({ isOnline: true, hasActiveTrip: true }))
            .toBe(LOCATION_INTERVAL_ACTIVE_MS)
    })

    it('OFFLINE sem serviço não emite', () => {
        expect(resolveLocationIntervalMs({ isOnline: false, hasActiveTrip: false })).toBeNull()
    })

    it('distingue ride / parcel / presential sem misturar com ONLINE', () => {
        expect(resolveServiceKind({
            captainRide: { status: 'started', source: 'driver_initiated' },
            captainParcel: null,
        })).toBe('presential')

        expect(resolveServiceKind({
            captainRide: { status: 'accepted', source: 'passenger' },
            captainParcel: null,
        })).toBe('ride')

        expect(resolveServiceKind({
            captainRide: null,
            captainParcel: { status: 'in_transit' },
        })).toBe('parcel')

        expect(hasActiveService({
            captainRide: { status: 'finished' },
            captainParcel: null,
        })).toBe(false)
    })
})
