import api from '@/shared/services/axios'
import { getAccessToken } from '@/shared/services/session'

export const EARNINGS_RANGES = [
    { value: 'day', label: 'Hoje', title: 'Ganhos de hoje' },
    { value: 'week', label: '7 dias', title: 'Ganhos dos últimos 7 dias' },
    { value: 'month', label: '30 dias', title: 'Ganhos dos últimos 30 dias' },
]

export function isEarningsNumber(value) {
    return typeof value === 'number' && Number.isFinite(value)
}

// Uma resposta inválida não substitui a última consulta válida no cache.
export function validateEarnings(data, range) {
    if (!data || !isEarningsNumber(data.totalEarnings)
        || !Number.isInteger(data.totalRides) || data.totalRides < 0
        || !Array.isArray(data.rides) || (data.range && data.range !== range)
        || data.rides.some(ride => !ride || typeof ride !== 'object' || !ride.rideId
            || (ride.pickup != null && typeof ride.pickup !== 'string')
            || (ride.destination != null && typeof ride.destination !== 'string'))) {
        throw new Error('Resposta de ganhos incompleta')
    }
    return data
}

export async function fetchDriverEarnings(range, signal) {
    const token = getAccessToken('captain')
    if (!token) throw new Error('Sessão ainda não disponível')
    const { data } = await api.get(`/captains/earnings?range=${range}`, {
        signal, headers: { Authorization: `Bearer ${token}` },
    })
    return validateEarnings(data, range)
}
