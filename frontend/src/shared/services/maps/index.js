import { createLeafletProvider } from './leafletProvider'
import { createGoogleMapsProvider } from './googleMapsProvider'
import { isNativePlatform } from '@/shared/platform/platform'

const MAPS_PROVIDER = import.meta.env.VITE_MAPS_PROVIDER || 'leaflet'

// Espelha o seletor do backend (Backend/services/maps/index.js): falha alto e cedo
// se um provider desconhecido for pedido, em vez de degradar silenciosamente.
// No Capacitor (APK motorista) força Google — Leaflet é só fallback web local.
export function createMapProvider() {
    const provider = isNativePlatform() ? 'google' : MAPS_PROVIDER

    if (provider === 'leaflet') {
        return createLeafletProvider()
    }
    if (provider === 'google') {
        return createGoogleMapsProvider()
    }
    throw new Error(`VITE_MAPS_PROVIDER desconhecido: "${provider}". Valores válidos: "leaflet", "google".`)
}
