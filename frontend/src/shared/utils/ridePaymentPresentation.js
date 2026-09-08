const LABELS = { cash: 'Dinheiro', pix: 'Pix', carteira: 'Carteira', card: 'Cartão' }

export function paymentMethodLabel(method) {
    return LABELS[method] || 'Forma de pagamento não informada'
}

export function moneyOrNull(value) {
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null
    const amount = Number(value)
    return Number.isFinite(amount) && amount >= 0 ? amount : null
}

// Não calcular comissão nem inferir recebimento a partir de paymentStatus=paid:
// dinheiro/Pix são liquidados contabilmente pelo backend ao finalizar a viagem.
export function ridePaymentPresentation(ride, { pendingFinalization = false } = {}) {
    const method = ride?.paymentMethod
    const direct = method === 'cash' || method === 'pix'
    const platform = method === 'carteira' || method === 'card'
    const collectionAmount = !pendingFinalization && direct ? moneyOrNull(ride?.collectionAmount) : null
    return {
        label: paymentMethodLabel(method), direct, platform,
        total: moneyOrNull(ride?.finalPrice),
        collectionAmount,
        driverAmount: pendingFinalization ? null : moneyOrNull(ride?.driverAmount),
        instruction: platform
            ? `Pagamento por ${method === 'card' ? 'cartão' : 'carteira'} no aplicativo. Não solicite dinheiro ou Pix diretamente.`
            : direct && collectionAmount === 0
                ? 'Não há valor a receber diretamente. Não solicite outro pagamento.'
            : direct
                ? `Confira o recebimento ${method === 'pix' ? 'do Pix na sua conta' : 'do dinheiro com o passageiro'}. O registro no aplicativo não comprova esse recebimento.`
                : 'Confira a forma de pagamento com o suporte antes de cobrar. Não solicite um segundo pagamento.',
    }
}
