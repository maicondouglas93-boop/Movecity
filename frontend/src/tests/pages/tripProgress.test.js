import { describe, expect, it } from 'vitest'
import { getTripProgressMessage } from '@/passenger/utils/tripProgress'

describe('mensagens de progresso da viagem', () => {
    it('acolhe o passageiro no começo da corrida', () => {
        expect(getTripProgressMessage({ progress: 0.1 }).title).toBe('Sua viagem começou')
    })

    it('avisa quando chega à metade do caminho', () => {
        expect(getTripProgressMessage({ progress: 0.5 }).title).toBe('Já estamos na metade do caminho')
    })

    it('informa distância e tempo perto do destino', () => {
        const message = getTripProgressMessage({ progress: 0.85, remainingKm: 2.36, etaMinutes: 6.2 })
        expect(message.title).toBe('Estamos chegando!')
        expect(message.text).toContain('2.4 km e 6 min')
    })
})
