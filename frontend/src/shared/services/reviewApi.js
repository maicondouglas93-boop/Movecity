import api from '@/shared/services/axios';

// Avaliação pós-corrida (passageiro → motorista). Alimenta captain.rating de verdade —
// antes nenhum fluxo escrevia essa nota, ela ficava presa no default do schema (5.0)
// pra sempre, motorista bom ou ruim.
export async function submitReview({ rideId, rating, comment }) {
    const response = await api.post('/rides/review', { rideId, rating, comment });
    return response.data;
}
