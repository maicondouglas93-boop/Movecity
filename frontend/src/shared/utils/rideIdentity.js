// Presença/coerência local; formato MongoDB e autorização continuam no servidor.
export const hasRideId = id => typeof id === 'string' && id.trim().length > 0
    && id === id.trim() && !['undefined', 'null'].includes(id)

export const isStartedRide = ride => hasRideId(ride?._id) && ride.status === 'started'

export const hasFinalizationTarget = action => hasRideId(action?.rideId)
    && action.payload?.rideId === action.rideId

export const MISSING_RIDE_MESSAGE = 'Os dados da corrida não estão disponíveis. Abra Corridas para recuperar a viagem antes de finalizar.'
