import { beforeEach, describe, expect, it, vi } from 'vitest'
import { presentNativeRideOffer } from '@/shared/platform/nativeRideOffer.service'

const mocks = vi.hoisted(() => ({ presentOffer: vi.fn(), native: true }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => mocks }))
vi.mock('@/shared/platform/platform', () => ({ isNativePlatform: () => mocks.native }))

describe('bridge da tela nativa de ofertas', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.native = true
        mocks.presentOffer.mockResolvedValue(undefined)
    })

    it.each(['ride', 'parcel'])('transporta id e prazo autoritativo de %s', async (kind) => {
        const idKey = kind === 'ride' ? 'rideId' : 'parcelId'
        const offerExpiresAt = '2026-09-11T17:00:45.000Z'
        expect(await presentNativeRideOffer({ kind, [idKey]: 'offer-1', fare: 11.13, offerExpiresAt }))
            .toEqual({ presented: true })
        expect(mocks.presentOffer).toHaveBeenCalledWith({
            type: kind === 'ride' ? 'NEW_RIDE' : 'NEW_PARCEL',
            [idKey]: 'offer-1', fare: '11.13', offerExpiresAt,
        })
    })

    it('não tenta abrir Activity na web', async () => {
        mocks.native = false
        expect(await presentNativeRideOffer({ rideId: 'r' })).toEqual({ presented: false })
        expect(mocks.presentOffer).not.toHaveBeenCalled()
    })

    it('reporta falha da ponte sem propagar erro ao socket', async () => {
        mocks.presentOffer.mockRejectedValue(new Error('native unavailable'))
        expect(await presentNativeRideOffer({ rideId: 'r' }))
            .toEqual({ presented: false, error: 'native unavailable' })
    })
})
