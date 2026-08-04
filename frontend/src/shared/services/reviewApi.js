import api from '@/shared/services/axios';

// Avaliação pós-corrida/encomenda (passageiro → motorista).
export async function submitReview({ rideId, parcelId, subjectType = 'ride', subjectId, rating, comment }) {
    const type = subjectType === 'parcel' || parcelId ? 'parcel' : 'ride';
    const id = subjectId || parcelId || rideId;

    if (type === 'parcel') {
        const response = await api.post('/parcels/review', {
            parcelId: id,
            subjectId: id,
            rating,
            comment,
        });
        return response.data;
    }

    const response = await api.post('/rides/review', { rideId: id, rating, comment });
    return response.data;
}

export async function submitCaptainReview({ rideId, parcelId, subjectType = 'ride', subjectId, rating, comment }) {
    const type = subjectType === 'parcel' || parcelId ? 'parcel' : 'ride';
    const id = subjectId || parcelId || rideId;

    if (type === 'parcel') {
        const response = await api.post('/parcels/captain-review', {
            parcelId: id,
            subjectId: id,
            rating,
            comment,
        });
        return response.data;
    }

    const response = await api.post('/rides/captain-review', { rideId: id, rating, comment });
    return response.data;
}
