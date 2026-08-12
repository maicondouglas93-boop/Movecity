import { describe, expect, it } from 'vitest'
import {
    calculateFareDifference,
    describeLiveFareFreshness,
    normalizeLiveFare,
} from '@/passenger/utils/liveFarePresentation'

describe('apresentação da tarifa ao vivo', () => {
    it('normaliza o snapshot vindo do socket ou da API', () => {
        expect(normalizeLiveFare({
            amount: '28.40',
            actualDistance: '2400',
            calculatedAt: '2026-08-12T12:00:00.000Z',
        })).toEqual({
            amount: 28.4,
            actualDistance: 2400,
            calculatedAt: new Date('2026-08-12T12:00:00.000Z').getTime(),
        })
    })

    it('identifica valor recente, desatualizado e offline', () => {
        const now = 100_000
        expect(describeLiveFareFreshness({ updatedAt: 98_000, now, online: true })).toEqual({
            label: 'Atualizado agora',
            stale: false,
        })
        expect(describeLiveFareFreshness({ updatedAt: 40_000, now, online: true })).toEqual({
            label: 'Valor desatualizado há 60s',
            stale: true,
        })
        expect(describeLiveFareFreshness({ updatedAt: 98_000, now, online: false }).stale).toBe(true)
    })

    it('calcula a diferença para a estimativa inicial', () => {
        expect(calculateFareDifference(31.5, 28)).toBe(3.5)
    })
})
