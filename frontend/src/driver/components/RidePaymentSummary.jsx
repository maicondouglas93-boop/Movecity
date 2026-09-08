import { formatBRL } from '@/shared/utils/currency'
import { ridePaymentPresentation } from '@/shared/utils/ridePaymentPresentation'

export default function RidePaymentSummary({ ride, pendingFinalization = false, pendingPayment = false }) {
    const payment = ridePaymentPresentation(ride, { pendingFinalization })
    return <section aria-label="Resumo do pagamento" className="w-full space-y-3 text-ink-900">
        <p className="text-sm">Forma de pagamento: <strong>{payment.label}</strong></p>
        <p className="text-sm text-ink-700">{payment.instruction}</p>
        {payment.total != null && <div className="rounded-panel border border-line bg-surface-alt p-4">
            <p className="text-sm text-ink-600">{pendingFinalization ? 'Estimativa total no aparelho' : 'Valor total da corrida'}</p>
            <p className="text-2xl font-bold">{formatBRL(payment.total)}</p>
        </div>}
        {pendingFinalization ? <p className="text-sm text-ink-700">
            O pedido está salvo no aparelho. O servidor ainda precisa validar a finalização e o valor poderá ser ajustado.
        </p> : <>
            {payment.direct && <div className="rounded-panel border border-line p-4">
                <p className="text-sm">Valor a receber diretamente</p>
                <p className="text-xl font-bold">{payment.collectionAmount == null ? 'A confirmar no sistema' : formatBRL(payment.collectionAmount)}</p>
                {payment.collectionAmount == null && <p className="mt-1 text-sm text-ink-700">Não use o total como uma nova cobrança: pode haver valor já pago pelo aplicativo.</p>}
            </div>}
            {payment.platform && <p className="font-semibold text-sm">
                {ride?.paymentStatus === 'paid' ? 'Pagamento registrado pela plataforma.' : 'Pagamento no aplicativo ainda pendente. Acompanhe pelo suporte.'}
            </p>}
            {payment.driverAmount != null && <p className="text-sm">Ganho da corrida informado pelo sistema: <strong>{formatBRL(payment.driverAmount)}</strong>. Não é o valor a cobrar do passageiro.</p>}
        </>}
        {pendingPayment && <p role="status" className="text-sm text-amber-800">Sua confirmação de recebimento foi salva no aparelho e aguarda sincronização.</p>}
    </section>
}
