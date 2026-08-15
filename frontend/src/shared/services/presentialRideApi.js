import api from '@/shared/services/axios'

export function getPresentialVehicleOptions() {
  return api.get('/rides/presential/vehicle-types').then((r) => r.data)
}

export function estimatePresentialFare({ destination, lat, lng, vehicleType }) {
  return api.get('/rides/presential/estimate', {
    params: {
      destination,
      ...(lat != null ? { lat } : {}),
      ...(lng != null ? { lng } : {}),
      ...(vehicleType ? { vehicleType } : {}),
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
