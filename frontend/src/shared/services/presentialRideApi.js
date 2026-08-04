import api from '@/shared/services/axios'

export function estimatePresentialFare({ destination, lat, lng }) {
  return api.get('/rides/presential/estimate', {
    params: {
      destination,
      ...(lat != null ? { lat } : {}),
      ...(lng != null ? { lng } : {}),
    },
  }).then((r) => r.data)
}

export function createPresentialRide(payload) {
  return api.post('/rides/presential', payload).then((r) => r.data)
}

export function startPresentialRide({ rideId, otp }) {
  return api.get('/rides/start-ride', {
    params: { rideId, otp },
  }).then((r) => r.data)
}
