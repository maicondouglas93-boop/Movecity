import api from '@/shared/services/axios';

// Cliente HTTP para /maps/*. Criado para centralizar chamadas que antes ficavam
// espalhadas com axios cru + headers manuais (ex: Home.jsx chamando photon.komoot.io
// direto do browser, fora do backend e fora do cache).
export async function reverseGeocode(lat, lng) {
    const response = await api.get('/maps/reverse-geocode', { params: { lat, lng } });
    return response.data; // { address: string }
}

// Resolve coordenadas de um placeId (Places New — provider google). sessionToken é
// opcional, mas mantê-lo igual ao usado no autocomplete que originou o placeId reduz
// o custo (cobrança de sessão combinada em vez de chamada avulsa).
export async function getPlaceDetails(placeId, sessionToken) {
    const response = await api.get('/maps/place-details', { params: { placeId, sessionToken } });
    return response.data; // { ltd: number, lng: number, address: string }
}
