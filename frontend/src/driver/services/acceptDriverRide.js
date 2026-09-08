import api from '@/shared/services/axios'
import { withHardTimeout } from '@/shared/utils/hardTimeout'
import { hasRideId } from '@/shared/utils/rideIdentity'
import { isRideAssignedToCaptain, isRideConnectivityError } from '@/shared/utils/driverRideState'
import { hasPendingFinalization } from '@/shared/services/offlineQueue'

async function readAssignment(captainId) {
    try {
        const { data } = await withHardTimeout(api.get('/rides/captain-current'))
        if (data == null) return null
        if (!isRideAssignedToCaptain(data, captainId)) throw new Error('INVALID_RIDE_ASSIGNMENT')
        if (await hasPendingFinalization(data._id, { throwOnError: true })) {
            const error = new Error('Sua finalização ainda está pendente. Confira a viagem em Corridas antes de aceitar outra.')
            error.finalizationPending = true
            throw error
        }
        return data
    } catch (error) {
        if (error.response?.status === 404) return null
        throw error
    }
}

// Ofertas são competitivas: nunca entram na fila offline. Depois de perder uma
// resposta, consultar a atribuição antes de repetir o aceite do MESMO ID.
export async function acceptDriverRide(ride, captainId, { reconcileFirst = false } = {}) {
    if (!hasRideId(ride?._id) || !captainId) throw new Error('Corrida indisponível para aceite.')
    if (reconcileFirst) {
        try {
            const current = await readAssignment(captainId)
            if (current) return current
        } catch (error) {
            if (error.finalizationPending) throw error
            error.acceptanceUncertain = true
            throw error
        }
    }
    if (navigator.onLine === false) throw new Error('Conecte-se à internet para confirmar o aceite.')

    try {
        const { data } = await withHardTimeout(api.post(`/rides/${ride._id}/accept`, {}))
        if (data?._id !== ride._id || !isRideAssignedToCaptain(data, captainId)) {
            const error = new Error('Resposta de aceite incompleta. Verifique a confirmação.')
            error.acceptanceUncertain = true
            throw error
        }
        return data
    } catch (error) {
        const ambiguous = isRideConnectivityError(error) || error.acceptanceUncertain
            || error.response?.status >= 500
        if (!ambiguous && error.response?.status !== 409) throw error
        try {
            const current = await readAssignment(captainId)
            if (current) return current
        } catch (recoveryError) {
            if (recoveryError.finalizationPending) throw recoveryError
            // Um 409 também pode ser a própria atribuição, cujo ACK se perdeu.
            error.acceptanceUncertain = true
            throw error
        }
        error.acceptanceUncertain = Boolean(ambiguous)
        throw error
    }
}
