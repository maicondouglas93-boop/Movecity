import { describe, it, expect } from 'vitest'
import { addressFromInput, coordFromInput, sanitizeCoord } from '@/services/maps/parseLocation'

describe('parseLocation', () => {
    it('extrai lat/lng embutidos no formato da Home', () => {
        const input = 'Tv. João Caetano, 56 - Lajinha, MG, 36980-000, Brazil (-20.1577267, -41.6206133)'
        expect(coordFromInput(input)).toEqual({ lat: -20.1577267, lng: -41.6206133 })
        expect(addressFromInput(input)).toBe('Tv. João Caetano, 56 - Lajinha, MG, 36980-000, Brazil')
    })

    it('usa objeto com lat/lng ou ltd/lng', () => {
        expect(coordFromInput({ lat: -20.1, lng: -41.5 })).toEqual({ lat: -20.1, lng: -41.5 })
        expect(coordFromInput({ ltd: -20.1, lng: -41.5 })).toEqual({ lat: -20.1, lng: -41.5 })
    })

    it('rejeita coordenada inválida', () => {
        expect(sanitizeCoord(100, 0)).toBeNull()
        expect(coordFromInput('só endereço sem coords')).toBeNull()
    })
})
