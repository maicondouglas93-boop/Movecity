import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOfferQueue } from '@/shared/services/rideOffer/useOfferQueue'
import { isOfferExpired } from '@/shared/services/rideOffer/offerExpiry'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
const offer = (id, delay) => ({ _id: id, offerExpiresAt: new Date(Date.now() + delay).toISOString() })

describe('ofertas: prazo absoluto, fila e retomada', () => {
    it.each([0, -1])('rejeita prazo vencido (%s) inclusive por deep link', delay => {
        const { result } = renderHook(useOfferQueue)
        act(() => expect(result.current.enqueue('ride', offer('r1', delay), { front: true })).toBe(false))
        expect(result.current.active).toBeNull()
    })
    it('rejeita data inválida e preserva compatibilidade de DTO sem prazo', () => {
        expect(isOfferExpired({ offerExpiresAt: 'inválido' })).toBe(true)
        expect(isOfferExpired({})).toBe(false)
    })
    it('expira também ofertas atrás da primeira e não reinicia o prazo', () => {
        const { result } = renderHook(useOfferQueue)
        act(() => {
            result.current.enqueue('ride', offer('r1', 3000))
            result.current.enqueue('parcel', offer('p1', 1000))
            result.current.enqueue('ride', offer('r2', 9000))
        })
        act(() => vi.advanceTimersByTime(3500))
        expect(result.current.active.offerId).toBe('r2')
        expect(result.current.queueLength).toBe(1)
    })
    it.each(['focus', 'pageshow', 'visibilitychange'])('descarta oferta suspensa ao receber %s', event => {
        const { result } = renderHook(useOfferQueue)
        act(() => result.current.enqueue('ride', offer('r1', 1000)))
        vi.setSystemTime(Date.now() + 2000)
        act(() => (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)))
        expect(result.current.active).toBeNull()
    })
    it('deduplica socket/pull e limpa deduplicação na troca de conta', () => {
        const { result } = renderHook(useOfferQueue)
        const data = offer('r1', 60000)
        act(() => {
            expect(result.current.enqueue('ride', data)).toBe(true)
            expect(result.current.enqueue('ride', data)).toBe(false)
        })
        expect(result.current.queueLength).toBe(1)
        act(() => result.current.clear())
        act(() => expect(result.current.enqueue('ride', data)).toBe(true))
        expect(result.current.queueLength).toBe(1)
    })
})
