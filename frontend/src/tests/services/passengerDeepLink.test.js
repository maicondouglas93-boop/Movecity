import { normalizePassengerDeepLink } from '@/passenger/platform/passengerDeepLink.service'
import { describe, expect, it } from 'vitest'

describe('deep link nativo do Passageiro', () => {
    it('aceita as rotas emitidas pelo backend e preserva query string', () => {
        expect(normalizePassengerDeepLink('/riding?rideId=ride-1'))
            .toBe('/riding?rideId=ride-1')
        expect(normalizePassengerDeepLink('encomenda/ativa'))
            .toBe('/encomenda/ativa')
        expect(normalizePassengerDeepLink('https://app.movecity.com/scheduled'))
            .toBe('/scheduled')
    })

    it('rejeita rotas do Motorista, logout e URLs sem rota autorizada', () => {
        expect(normalizePassengerDeepLink('/captain-home')).toBeNull()
        expect(normalizePassengerDeepLink('/user/logout')).toBeNull()
        expect(normalizePassengerDeepLink('https://example.com/')).toBeNull()
        expect(normalizePassengerDeepLink('')).toBeNull()
    })
})
