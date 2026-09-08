// Somente apresentação. Não altera a aceitação de pontos GPS ou a tarifa.
export const TRIP_GPS_STALE_MS = 15_000
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function rideGpsPresentation(location, error, now = Date.now()) {
    const valid = Number.isFinite(location?.lat) && Math.abs(location.lat) <= 90
        && Number.isFinite(location?.lng) && Math.abs(location.lng) <= 180
    const ageMs = Number.isFinite(location?.timestamp) && location.timestamp <= now ? now - location.timestamp : null
    if (error) return { key: 'error', title: 'GPS indisponível', detail: String(error), usable: false, ageMs }
    if (!valid || ageMs == null) return { key: 'missing', title: 'Aguardando GPS', detail: 'Ainda não há uma posição recente do aparelho. Confira a localização.', usable: false, ageMs }
    if (ageMs > TRIP_GPS_STALE_MS) return { key: 'stale', title: 'GPS sem atualização recente', detail: 'Tempo pode continuar contando; a distância depende de novos pontos válidos do GPS.', usable: false, ageMs }
    // O filtro de percurso existente rejeita precisão acima de 100m.
    if (location.accuracy != null && (!finite(location.accuracy) || location.accuracy > 100)) return { key: 'weak', title: 'GPS com baixa precisão', detail: 'Pontos imprecisos podem não entrar na distância. Confira o sinal em um local seguro.', usable: false, ageMs }
    return { key: 'ready', title: 'GPS recente', detail: location.accuracy == null
        ? 'O aparelho não informou a precisão.' : `Precisão informada pelo aparelho: cerca de ${Math.round(location.accuracy)} m.`, usable: true, ageMs }
}

export function activeRidePresentation({ ride, meter, internet, connected, location, locationError, now = Date.now() }) {
    const gps = rideGpsPresentation(location, locationError, now)
    const current = meter?.rideId === ride?._id ? meter : null
    let amount = null, label = 'Valor da corrida', source = 'waiting'
    let explanation = 'Aguardando dados para atualizar o valor.'
    if (current?.calculationError || current?.unavailable) {
        amount = finite(current.amount) ? current.amount : null
        label = amount == null ? 'Valor indisponível' : 'Último valor disponível'
        source = current.calculationError ? 'read-error' : 'unavailable'
        explanation = current.calculationError
            ? 'Não foi possível ler o cálculo no aparelho. O valor mostrado não está sendo atualizado. Tente novamente ou abra a ajuda.'
            : 'A tarifa local não está disponível. Aguarde a atualização antes de usar este valor como cobrança.'
    } else if (finite(current?.amount)) {
        amount = current.amount
        source = current.local ? 'local' : 'server'
        label = current.local ? 'Estimativa no aparelho' : 'Valor atualizado pelo servidor'
        explanation = current.local
            ? !internet ? 'Calculando no aparelho. A confirmação depende da volta da conexão.'
                : !connected ? 'Calculando no aparelho enquanto reconecta ao servidor.'
                    : 'Calculando no aparelho enquanto aguarda confirmação do servidor.'
            : 'Valor em andamento; confira o valor final ao encerrar.'
    } else if (finite(ride?.liveFare?.amount)) {
        amount = ride.liveFare.amount
        label = 'Último valor disponível'
        explanation = 'Aguardando atualização da medição.'
    } else if (!ride?.destinationPending && finite(ride?.fare)) {
        amount = ride.fare
        label = 'Estimativa inicial da viagem'
        explanation = 'Ainda não é o valor medido da corrida.'
    }
    return { gps, amount, label, source, explanation,
        distance: finite(current?.distance) ? current.distance : finite(ride?.actualDistance) ? ride.actualDistance : null,
        connectionLabel: !internet ? 'Sem internet' : !connected ? 'Reconectando ao servidor' : 'Conectado ao servidor',
    }
}

export function activeRideSupportMessage(ride, presentation) {
    // Contexto mínimo visível ao motorista; sem token, telefone ou localização.
    return [`Sou motorista MoveCity e preciso de ajuda com uma corrida em andamento.`,
        `Corrida: ${ride?._id || 'identificação indisponível'}`,
        `Conexão: ${presentation.connectionLabel}.`, `GPS: ${presentation.gps.title}.`,
        `Medição: ${presentation.label}.`, 'Problema: '].join('\n')
}
