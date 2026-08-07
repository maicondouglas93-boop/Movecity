import api from '@/shared/services/axios';

// Catálogo de categorias de veículo — 100% controlado pelo painel admin (nome, descrição,
// capacidade, ícone, ordem). Endpoint público: usado tanto no fluxo do passageiro quanto
// no cadastro do motorista, antes de ele ter uma conta.
//
// `service` opcional filtra por allowedServices no backend:
//   ride | parcel | scheduledRide | scheduledParcel
export async function getVehicleCategories(service) {
    const params = service ? { service } : undefined;
    const response = await api.get('/vehicle-categories', { params });
    return response.data; // [{ name, displayName, description, capacity, iconKey, sortOrder, allowedServices }]
}
