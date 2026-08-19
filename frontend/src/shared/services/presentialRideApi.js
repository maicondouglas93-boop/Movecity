import api from '@/shared/services/axios'
import { withHardTimeout } from '@/shared/utils/hardTimeout'

// Todas as chamadas do presencial passam por withHardTimeout.
//
// O app instalado roteia HTTP pela camada nativa (CapacitorHttp) e o `timeout` do axios
// NÃO é aplicado lá: sem conectividade a requisição não falha, fica pendurada. Como todo
// tratamento de erro mora no catch, ele nunca roda — o motorista via o botão girando pra
// sempre, no meio da rua, sem saber se a corrida foi criada.
//
// É o fluxo principal da operação hoje e acontece exatamente onde o sinal é pior, então
// nenhuma destas quatro pode ficar sem teto. (No navegador o timeout do axios já
// funcionava; o buraco era só no APK.)

export function getPresentialVehicleOptions() {
  return withHardTimeout(api.get('/rides/presential/vehicle-types')).then((r) => r.data)
}

export function estimatePresentialFare({ destination, lat, lng, vehicleType }) {
  return withHardTimeout(
    api.get('/rides/presential/estimate', {
      params: {
        destination,
        ...(lat != null ? { lat } : {}),
        ...(lng != null ? { lng } : {}),
        ...(vehicleType ? { vehicleType } : {}),
      },
    }),
  ).then((r) => r.data)
}

export function createPresentialRide(payload) {
  return withHardTimeout(api.post('/rides/presential', payload)).then((r) => r.data)
}

export function startPresentialRide({ rideId, otp }) {
  return withHardTimeout(
    api.get('/rides/start-ride', {
      params: { rideId, otp },
    }),
  ).then((r) => r.data)
}
