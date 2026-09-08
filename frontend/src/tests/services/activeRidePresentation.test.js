import { describe, expect, it } from 'vitest'
import { activeRidePresentation, rideGpsPresentation, activeRideSupportMessage } from '@/driver/services/activeRidePresentation'

const now = 100_000
const point = { lat: -20, lng: -41, accuracy: 15, timestamp: now }
const ride = { _id: 'ride-1', fare: 20, actualDistance: 100, user: { phone: 'private-phone' }, pickup: 'private-address' }
const base = { ride, internet: true, connected: true, now, location: point }
const meter = { rideId: ride._id, amount: 25, distance: 500, local: true }
describe('GPS, conexão e medição da viagem', () => {
    it.each([
        [point, null, 'ready'], [{ ...point, accuracy: null }, null, 'ready'],
        [null, null, 'missing'], [{ lat: -20, lng: -41 }, null, 'missing'],
        [{ ...point, timestamp: now + 100 }, null, 'missing'],
        [{ ...point, timestamp: now - 16000 }, null, 'stale'],
        [{ ...point, accuracy: 101 }, null, 'weak'], [{ ...point, accuracy: -1 }, null, 'weak'],
        [{ ...point, lat: 91 }, null, 'missing'], [point, 'Permissão negada', 'error'],
    ])('GPS %j / %s → %s', (location, error, key) => expect(rideGpsPresentation(location, error, now).key).toBe(key))
    it('rede disponível e confirmação atrasada não vira aviso de internet ausente', () => {
        const result = activeRidePresentation({ ...base, meter })
        expect(result.label).toBe('Estimativa no aparelho')
        expect(result.explanation).toContain('aguarda confirmação')
        expect(result.explanation).not.toMatch(/sem internet|volta da conexão/i)
        expect(result.connectionLabel).toBe('Conectado ao servidor')
    })
    it.each([false, true])('GPS funciona independentemente de internet=%s', internet => {
        const result = activeRidePresentation({ ...base, meter, internet })
        expect(result.gps.usable).toBe(true)
        expect(result.amount).toBe(25)
        expect(result.source).toBe('local')
    })
    it('conectado sem GPS não promete distância nem navegação confiável', () => {
        const result = activeRidePresentation({ ...base, meter, locationError: 'GPS negado' })
        expect(result.gps.usable).toBe(false)
        expect(result.distance).toBe(500)
        expect(result.connectionLabel).toBe('Conectado ao servidor')
    })
    it('falha de armazenamento não chama o valor antigo de atual', () => {
        const result = activeRidePresentation({ ...base, meter: { ...meter, calculationError: true } })
        expect(result.amount).toBe(25)
        expect(result.label).toBe('Último valor disponível')
        expect(result.source).toBe('read-error')
        expect(result.explanation).toContain('não está sendo atualizado')
    })
    it('tarifa indisponível não é falta de rede e não libera cobrança pelo valor antigo', () => {
        const result = activeRidePresentation({ ...base, meter: { ...meter, unavailable: true } })
        expect(result.label).toBe('Último valor disponível')
        expect(result.explanation).toContain('A tarifa local não está disponível')
    })
    it('distingue estimativa inicial do valor medido', () => {
        const result = activeRidePresentation(base)
        expect(result.amount).toBe(20)
        expect(result.label).toBe('Estimativa inicial da viagem')
    })
    it('não mistura medidor de outra corrida nem inventa preço/km de presencial', () => {
        const result = activeRidePresentation({ ...base, ride: { _id: 'new', destinationPending: true }, meter })
        expect(result.amount).toBeNull()
        expect(result.distance).toBeNull()
    })
    it('aceita valor zero real e rejeita valor inválido', () => {
        expect(activeRidePresentation({ ...base, meter: { ...meter, amount: 0 } }).amount).toBe(0)
        expect(activeRidePresentation({ ...base, ride: { _id: ride._id }, meter: { ...meter, amount: NaN } }).amount).toBeNull()
    })
    it('contexto de ajuda não inclui passageiro, endereço ou credenciais', () => {
        const message = activeRideSupportMessage({ ...ride, token: 'secret-token' }, activeRidePresentation(base))
        expect(message).toContain('Corrida: ride-1')
        expect(message).not.toMatch(/private-phone|private-address|secret-token/)
    })
})
