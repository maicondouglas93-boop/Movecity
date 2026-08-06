import { registerPlugin } from '@capacitor/core'
import { isNativePlatform } from '@/shared/platform/platform'

const NativeRideOffer = registerPlugin('NativeRideOffer')

/**
 * Abre a RideOfferActivity nativa (som/vibração/tela cheia) sem depender do toque
 * na notificação. No-op na web/PWA.
 */
export async function presentNativeRideOffer(payload = {}) {
    if (!isNativePlatform()) return { presented: false }
    try {
        const data = {
            type: payload.type || (payload.kind === 'parcel' ? 'NEW_PARCEL' : 'NEW_RIDE'),
            rideId: payload.rideId != null ? String(payload.rideId) : undefined,
            parcelId: payload.parcelId != null ? String(payload.parcelId) : undefined,
            title: payload.title || undefined,
            message: payload.message || undefined,
            fare: payload.fare != null ? String(payload.fare) : undefined,
            pickup: payload.pickup || undefined,
            destination: payload.destination || undefined,
            deepLink: payload.deepLink || undefined,
        }
        Object.keys(data).forEach((k) => {
            if (data[k] === undefined) delete data[k]
        })
        await NativeRideOffer.presentOffer(data)
        return { presented: true }
    } catch (err) {
        console.warn('[NativeRideOffer] presentOffer failed:', err?.message || err)
        return { presented: false, error: err?.message }
    }
}
