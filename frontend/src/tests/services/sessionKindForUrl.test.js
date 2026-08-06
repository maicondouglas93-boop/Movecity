import { describe, it, expect } from 'vitest'
import { sessionKindForUrl } from '@/shared/services/session'

// Correção 401 do motorista (2026-08-03): rotas de corrida do motorista precisam
// resolver para 'captain', senão o interceptor injeta o token do passageiro (sessão
// dupla) ou falha o refresh com o kind errado.
describe('sessionKindForUrl', () => {
    it('classifica rotas exclusivas do motorista', () => {
        expect(sessionKindForUrl('/rides/update-status')).toBe('captain')
        expect(sessionKindForUrl('/rides/start-ride?rideId=1')).toBe('captain')
        expect(sessionKindForUrl('/rides/captain-cancel')).toBe('captain')
        expect(sessionKindForUrl('/rides/captain-current')).toBe('captain')
        expect(sessionKindForUrl('/rides/captain-history')).toBe('captain')
        expect(sessionKindForUrl('/rides/pending')).toBe('captain')
        expect(sessionKindForUrl('/rides/abc123/accept')).toBe('captain')
        expect(sessionKindForUrl('/rides/abc123/decline')).toBe('captain')
        expect(sessionKindForUrl('https://api.exemplo.com/rides/abc123/accept')).toBe('captain')
        expect(sessionKindForUrl('https://api.exemplo.com/rides/abc123/decline')).toBe('captain')
        expect(sessionKindForUrl('/parcels/captain-history')).toBe('captain')
        expect(sessionKindForUrl('/parcels/pending')).toBe('captain')
        expect(sessionKindForUrl('/captains/profile')).toBe('captain')
        expect(sessionKindForUrl('/uploads/captain-profile')).toBe('captain')
        expect(sessionKindForUrl('/uploads/document')).toBe('captain')
    })

    it('classifica rotas exclusivas do passageiro', () => {
        expect(sessionKindForUrl('/rides/create')).toBe('user')
        expect(sessionKindForUrl('/rides/current')).toBe('user')
        expect(sessionKindForUrl('/rides/cancel')).toBe('user')
        expect(sessionKindForUrl('/users/profile')).toBe('user')
        expect(sessionKindForUrl('/support/tickets')).toBe('user')
        expect(sessionKindForUrl('/uploads/profile')).toBe('user')
    })

    it('não confunde captain-cancel com cancel do passageiro', () => {
        expect(sessionKindForUrl('/rides/captain-cancel')).toBe('captain')
        expect(sessionKindForUrl('/rides/cancel')).toBe('user')
    })

    it('deixa rotas compartilhadas (maps) sem kind fixo', () => {
        expect(sessionKindForUrl('/maps/get-coordinates')).toBeNull()
        expect(sessionKindForUrl('/maps/get-route')).toBeNull()
    })
})
