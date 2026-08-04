/** Helpers de identidade compartilhada (Ride carro/moto + Parcel). */

export function personName(person) {
    if (!person) return ''
    const first = person.fullname?.firstname || person.firstname || ''
    const last = person.fullname?.lastname || person.lastname || ''
    return [first, last].filter(Boolean).join(' ').trim()
}

export function personFirstName(person) {
    return person?.fullname?.firstname || person?.firstname || ''
}

export function personLastName(person) {
    return person?.fullname?.lastname || person?.lastname || ''
}

export function personPhoto(person) {
    const url = person?.profilePicture || person?.photo || ''
    return typeof url === 'string' && url.trim() ? url.trim() : ''
}

export function formatRating(rating) {
    if (rating == null || rating === '') return null
    const n = Number(rating)
    if (!Number.isFinite(n)) return null
    return n.toFixed(1).replace('.', ',')
}

/** Resumo do veículo a partir do doc captain (ou vehicle embutido). */
export function vehicleSummary(captainOrVehicle, fallbackType) {
    const v = captainOrVehicle?.vehicle || captainOrVehicle || {}
    const type = v.vehicleType || fallbackType || ''
    const brandModel = [v.marca, v.modelo].filter(Boolean).join(' ').trim()
    const colorType = [v.color, type].filter(Boolean).join(' ').trim()
    const line = brandModel || colorType || (type === 'moto' ? 'Moto' : type === 'car' ? 'Carro' : 'Veículo')
    return {
        line,
        plate: v.plate || '',
        color: v.color || '',
        vehicleType: type,
        marca: v.marca || '',
        modelo: v.modelo || '',
    }
}
