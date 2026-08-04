import api from './axios'

export async function getParcelFare({ pickup, destination, vehicleType, size, weightKg }) {
    const { data } = await api.get('/parcels/fare', {
        params: { pickup, destination, vehicleType, size, weightKg },
    })
    return data
}

export async function createParcel(payload) {
    const { data } = await api.post('/parcels/create', payload)
    return data
}

export async function getCurrentParcel() {
    const { data } = await api.get('/parcels/current')
    return data
}

export async function cancelParcel(id, reason) {
    const { data } = await api.post(`/parcels/${id}/cancel`, { reason })
    return data
}

export async function getPendingParcels() {
    const { data } = await api.get('/parcels/pending')
    return data
}

export async function getCaptainCurrentParcel() {
    const { data } = await api.get('/parcels/captain-current')
    return data
}

export async function acceptParcel(id) {
    const { data } = await api.post(`/parcels/${id}/accept`)
    return data
}

export async function declineParcel(id) {
    const { data } = await api.post(`/parcels/${id}/decline`)
    return data
}

export async function updateParcelStatus(id, status) {
    const { data } = await api.patch(`/parcels/${id}/status`, { status })
    return data
}

export async function confirmParcelDelivery(id, pin) {
    const { data } = await api.post(`/parcels/${id}/confirm-delivery`, { pin })
    return data
}
