import carImg from './vehicle-car.png'
import motoImg from './vehicle-moto.png'
import autoImg from './vehicle-auto.png'
import bikeImg from './vehicle-bike.png'
import carroEconomicoImg from './vehicles/carro-economico.png'
import carroZonaRuralImg from './vehicles/carro-zona-rural.png'
import motoboyMotoTaxiImg from './vehicles/motoboy-moto-taxi.png'
import picapeFreteImg from './vehicles/picape-frete.png'

export const vehicleImages = {
    car: carImg,
    moto: motoImg,
    motorcycle: motoImg,
    auto: autoImg,
    bike: bikeImg,
    bicycle: bikeImg,
    bicicleta: bikeImg,
    // Arte própria das 4 categorias ativas em Lajinha. As chaves acima são por TIPO de
    // veículo e não distinguem duas categorias do mesmo tipo (econômico e zona rural são
    // ambos 'car'), por isso estas são indexadas pelo nome da categoria.
    carro_economico: carroEconomicoImg,
    carro_zona_rural: carroZonaRuralImg,
    motoboy_moto_taxi: motoboyMotoTaxiImg,
    picape_frete: picapeFreteImg,
}

// Normaliza qualquer rótulo ("Carro Econômico", "Motoboy-Moto Taxi") para a chave do mapa:
// sem acento, minúsculo, separadores viram "_". Assim a categoria cadastrada no painel
// encontra a arte pelo nome de exibição, sem depender de alguém preencher iconKey.
function assetKey(value) {
    if (!value) return ''
    return String(value)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
}

/**
 * Resolve a imagem de uma categoria testando, em ordem: iconKey explícito, nome interno,
 * nome de exibição e, por fim, o tipo de veículo. O fallback continua sendo o carro —
 * uma categoria nova cadastrada pelo painel nunca fica sem ícone.
 */
export function vehicleImageFor(category) {
    if (!category) return vehicleImages.car
    if (typeof category === 'string') {
        return vehicleImages[assetKey(category)] || vehicleImages[category] || vehicleImages.car
    }
    const candidates = [category.iconKey, category.name, category.displayName, category.vehicleType]
    for (const candidate of candidates) {
        const direct = candidate && vehicleImages[candidate]
        if (direct) return direct
        const normalized = candidate && vehicleImages[assetKey(candidate)]
        if (normalized) return normalized
    }
    return vehicleImages.car
}

export const vehicleLabels = {
    car: 'MoveGo',
    moto: 'MoveMoto',
    motorcycle: 'MoveMoto',
    auto: 'MoveAuto',
    bike: 'MoveBike',
    bicycle: 'MoveBike',
    bicicleta: 'MoveBike',
}
