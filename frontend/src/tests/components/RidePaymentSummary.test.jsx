import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import RidePaymentSummary from '@/driver/components/RidePaymentSummary'
import { paymentMethodLabel, moneyOrNull, ridePaymentPresentation } from '@/shared/utils/ridePaymentPresentation'

describe('resumo de pagamento do motorista', () => {
    it.each([['cash', 'Dinheiro'], ['pix', 'Pix'], ['carteira', 'Carteira'], ['card', 'Cartão']])('identifica %s sem trocar a forma de pagamento', (method, label) => {
        expect(paymentMethodLabel(method)).toBe(label)
    })
    it.each([null, undefined, '', ' ', NaN, Infinity, -1, [], {}, true])('não transforma valor ausente/inválido em R$ 0 (%j)', amount => {
        expect(moneyOrNull(amount)).toBeNull()
    })
    it('separa total, cobrança direta e ganho do motorista', () => {
        render(<RidePaymentSummary ride={{ paymentMethod: 'cash', paymentStatus: 'paid', finalPrice: 28, collectionAmount: 18, driverAmount: 23 }} />)
        expect(screen.getByText(/R\$\s*28,00/)).toBeInTheDocument()
        expect(screen.getByText(/R\$\s*18,00/)).toBeInTheDocument()
        expect(screen.getByText(/R\$\s*23,00/)).toBeInTheDocument()
        expect(screen.getByText(/não comprova esse recebimento/)).toBeInTheDocument()
    })
    it('não usa o total como cobrança direta ao receber DTO antigo', () => {
        render(<RidePaymentSummary ride={{ paymentMethod: 'cash', finalPrice: 28 }} />)
        expect(screen.getByText('A confirmar no sistema')).toBeInTheDocument()
        expect(screen.getByText(/pode haver valor já pago pelo aplicativo/)).toBeInTheDocument()
    })
    it.each(['card', 'carteira'])('não pede cobrança externa para %s, inclusive offline', method => {
        render(<RidePaymentSummary ride={{ paymentMethod: method, finalPrice: 28, collectionAmount: 28, driverAmount: 23 }} pendingFinalization />)
        expect(screen.getByText(/Não solicite dinheiro ou Pix diretamente/)).toBeInTheDocument()
        expect(screen.queryByText('Valor a receber diretamente')).toBeNull()
        expect(screen.queryByText(/R\$\s*23,00/)).toBeNull()
        expect(screen.getByText('Estimativa total no aparelho')).toBeInTheDocument()
    })
    it('cobrança direta zero não pede novo pagamento', () => {
        const view = ridePaymentPresentation({ paymentMethod: 'pix', finalPrice: 28, collectionAmount: 0 })
        expect(view.collectionAmount).toBe(0)
        expect(view.instruction).toMatch(/Não solicite outro pagamento/)
    })
    it('método desconhecido não vira dinheiro', () => {
        const view = ridePaymentPresentation({ paymentMethod: 'unknown', finalPrice: 28 })
        expect(view.direct).toBe(false)
        expect(view.label).toMatch(/não informada/)
        expect(view.instruction).toMatch(/suporte/)
    })
})
