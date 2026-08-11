const brlFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
})

export function formatCurrencyBRL(value, fallback = '—') {
    if (value == null || value === '') return fallback
    const amount = Number(value)
    if (!Number.isFinite(amount)) return fallback
    return brlFormatter.format(amount)
}

export function formatDistanceLabel(meters, fallback = null) {
    const value = Number(meters)
    if (!Number.isFinite(value) || value <= 0) return fallback
    if (value >= 1000) return `${numberFormatter.format(value / 1000)} km`
    return `${Math.round(value)} m`
}

export function formatDurationLabel(seconds, fallback = null) {
    const value = Number(seconds)
    if (!Number.isFinite(value) || value <= 0) return fallback
    const mins = Math.round(value / 60)
    if (mins < 60) return `${mins} min`
    const hours = Math.floor(mins / 60)
    const rest = mins % 60
    return rest ? `${hours} h ${rest} min` : `${hours} h`
}

export function paymentMethodLabel(method) {
    if (method === 'pix') return 'Pix'
    if (method === 'carteira') return 'Carteira'
    if (method === 'card' || method === 'cartao') return 'Cartão'
    if (method === 'cash' || method === 'dinheiro') return 'Dinheiro'
    return method || '—'
}

export function paymentStatusLabel(status, method) {
    if (method === 'carteira') return 'Pago pela carteira'
    if (status === 'paid') return 'Pagamento confirmado'
    if (status === 'pending') return 'Pagamento pendente'
    if (status === 'failed') return 'Pagamento recusado'
    if (status === 'refunded') return 'Pagamento reembolsado'
    return 'Status do pagamento não informado'
}
