import { createLeafletProvider } from './leafletProvider';
import { createGoogleMapsProvider } from './googleMapsProvider';

const MAPS_PROVIDER = import.meta.env.VITE_MAPS_PROVIDER || 'leaflet';

// Espelha o seletor do backend (Backend/services/maps/index.js): falha alto e cedo
// se um provider desconhecido for pedido, em vez de degradar silenciosamente.
export function createMapProvider() {
    if (MAPS_PROVIDER === 'leaflet') {
        return createLeafletProvider();
    }
    if (MAPS_PROVIDER === 'google') {
        return createGoogleMapsProvider();
    }
    throw new Error(`VITE_MAPS_PROVIDER desconhecido: "${MAPS_PROVIDER}". Valores válidos: "leaflet", "google".`);
}
