import { hasRideId } from '@/shared/utils/rideIdentity'

export const PICKUP_STATES = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger']

export function isRideAssignedToCaptain(ride, captainId) {
    const owner = typeof ride?.captain === 'object' ? ride.captain?._id : ride?.captain
    // O DTO autenticado do motorista omite `captain` (toRideCaptainDTO). A
    // atribuição vem das rotas authCaptain; se um snapshot trouxer dono, validá-lo.
    return hasRideId(ride?._id) && Boolean(captainId) && (owner == null || String(owner) === String(captainId))
        && [...PICKUP_STATES, 'started'].includes(ride.status)
}

// Uma resposta de regra/sessão não vira sucesso offline só porque o aparelho perdeu
// a rede logo depois. O timeout JS também cobre o HTTP nativo que não rejeita.
export function isRideConnectivityError(error) {
    if (error?.response?.status) return false
    return error?.isConnectivityIssue === true
        || ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error?.code)
        || error?.message === 'Network Error'
}
