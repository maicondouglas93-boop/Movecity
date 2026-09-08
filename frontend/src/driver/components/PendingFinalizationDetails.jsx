import { useRef, useState } from 'react'
import Button from '@/shared/components/ui/Button'
import { getSessionOwnerId } from '@/shared/services/session'
import { retryPendingFinalization } from '@/shared/services/offlineQueue'
import { canRetryFinalization, pendingReference, pendingSupportMessage, pendingTime } from '@/shared/utils/pendingFinalization'
import { supportEmailUrl, supportWhatsAppUrl } from '@/shared/utils/supportContacts'
import { paymentMethodLabel } from '@/shared/utils/ridePaymentPresentation'

export default function PendingFinalizationDetails({ action, socket, onResolved }) {
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState('')
    const busyRef = useRef(false)
    const canRetry = canRetryFinalization(action, getSessionOwnerId('captain'))
    const message = pendingSupportMessage(action)
    async function retry() {
        if (busyRef.current || !canRetry) return
        busyRef.current = true
        setBusy(true)
        setNotice('Sincronizando o pedido original...')
        try {
            const result = await retryPendingFinalization(action.id, { socket })
            if (result.status === 'resolved') {
                setNotice('Pendência sincronizada. Atualizando o histórico...')
                onResolved?.()
            } else {
                setNotice('A finalização ainda não foi confirmada. O pedido original continua salvo; confira a última resposta abaixo ou fale com o suporte.')
            }
        } catch (error) {
            setNotice(error.message || 'Não foi possível sincronizar. O pedido continua salvo.')
        } finally {
            busyRef.current = false
            setBusy(false)
        }
    }
    async function copy() {
        try {
            await navigator.clipboard.writeText(message)
            setNotice('Resumo copiado. Envie ao suporte pelo canal de sua preferência.')
        } catch {
            setNotice('Não foi possível copiar automaticamente. Selecione o resumo abaixo ou use um dos links de suporte.')
        }
    }
    return <details className="mt-3 border-t border-line pt-2">
        <summary className="min-h-[48px] cursor-pointer py-3 text-sm font-semibold text-ink-900">Ver detalhes e resolver</summary>
        <div className="space-y-3 text-sm text-ink-700">
            <p className="break-all font-semibold">{pendingReference(action)}</p>
            <dl className="space-y-2">
                <div><dt>Toque em finalizar</dt><dd>{pendingTime(action.payload?.finishTimestamp)}</dd></div>
                <div><dt>Salvo no aparelho</dt><dd>{pendingTime(action.timestamp)}</dd></div>
                <div><dt>Última tentativa</dt><dd>{pendingTime(action.lastAttemptAt)}</dd></div>
                <div><dt>Tentativas sem confirmação</dt><dd>{Number(action.attempts) || 0}</dd></div>
                <div><dt>Forma de pagamento</dt><dd>{paymentMethodLabel(action.rideSnapshot?.paymentMethod)}</dd></div>
                <div><dt>Última resposta</dt><dd>{action.lastError || 'Ainda não há confirmação registrada.'}{action.lastHttpStatus ? ` (HTTP ${action.lastHttpStatus})` : ''}</dd></div>
            </dl>
            {canRetry ? <>
                <p>A tentativa usa o mesmo ID e o horário original. Não cria outra corrida nem outra cobrança.</p>
                <Button onClick={retry} loading={busy}>Tentar sincronizar</Button>
            </> : <p>Este registro precisa de verificação pelo suporte antes de uma nova tentativa. Os dados permanecem no aparelho.</p>}
            {notice && <p role="status">{notice}</p>}
            <p>Revise o resumo antes de enviá-lo. Ele não inclui passageiro, endereço, GPS ou senha.</p>
            <textarea aria-label="Resumo para o suporte" readOnly value={message} rows={5}
                className="w-full rounded-panel border border-line bg-surface p-3 text-sm" />
            <Button variant="secondary" onClick={copy}>Copiar resumo</Button>
            <a className="flex min-h-[48px] items-center justify-center rounded-panel border border-line font-semibold text-ink-900"
                href={supportWhatsAppUrl(message)} target="_blank" rel="noopener noreferrer">Falar com suporte pelo WhatsApp</a>
            <a className="flex min-h-[48px] items-center justify-center text-ink-900 underline" href={supportEmailUrl(message)}>Enviar resumo por e-mail</a>
        </div>
    </details>
}
