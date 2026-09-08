// Prazo de DESTAQUE do servidor (offerPolicy): não é o cancelamento da corrida.
// Navegação/reconexão não renovam o popup; o card de pending continua autoritativo.
// Ausência é compatibilidade com DTO legado; data presente e inválida não é válida.
export function isOfferExpired(data, now = Date.now()) {
    if (data?.offerExpiresAt == null) return false
    const deadline = new Date(data.offerExpiresAt).getTime()
    return !Number.isFinite(deadline) || deadline <= now
}
