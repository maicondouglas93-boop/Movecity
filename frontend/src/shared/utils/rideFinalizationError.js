export function rideFinalizationError(error, fallback = 'Não foi possível finalizar a corrida.') {
    const data = error?.response?.data
    if (typeof data?.message === 'string' && data.message.trim()) return data.message
    const errors = Array.isArray(data?.errors) ? data.errors : []
    if (errors.some(item => (item?.path || item?.param) === 'rideId')) {
        return 'A identificação da corrida não foi aceita. Abra Corridas para recuperar os dados da viagem.'
    }
    const messages = [...new Set(errors.map(item => item?.msg)
        .filter(message => typeof message === 'string' && message.trim()))]
    return messages.length ? `Dados da finalização inválidos: ${messages.join('; ')}` : fallback
}
