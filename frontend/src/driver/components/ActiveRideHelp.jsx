/* eslint-disable react/prop-types */
import { SUPPORT_EMAIL, supportWhatsAppUrl } from '@/shared/utils/supportContacts'
import { activeRideSupportMessage } from '@/driver/services/activeRidePresentation'

export default function ActiveRideHelp({ ride, presentation, onClose }) {
    const message = activeRideSupportMessage(ride, presentation)
    return <div className="space-y-4 text-ink-900">
        <p className="text-sm">Use estes controles quando estiver parado em segurança. Abrir ajuda não cancela nem finaliza a corrida.</p>
        <section className="rounded-xl border border-danger-200 bg-danger-50 p-3">
            <h3 className="font-bold">Emergência no Brasil</h3>
            <p className="text-sm mt-1">Em perigo imediato, procure o serviço de emergência adequado. O suporte MoveCity não substitui esse atendimento.</p>
            {/* Códigos verificados na Anatel; abre o discador, não envia localização. */}
            <div className="flex flex-wrap gap-2 mt-3">
                <a href="tel:190" className="min-h-[48px] flex items-center rounded-xl bg-white border border-line px-3 py-2 font-semibold">Polícia · 190</a>
                <a href="tel:192" className="min-h-[48px] flex items-center rounded-xl bg-white border border-line px-3 py-2 font-semibold">SAMU · 192</a>
            </div>
            <p className="text-xs mt-2">Os links abrem o discador. Nenhum alerta ou localização é enviado automaticamente.</p>
        </section>
        <section className="space-y-2">
            <h3 className="font-bold">Problema na viagem ou no aplicativo</h3>
            <p className="text-sm">Explique o ocorrido ao suporte. Este contato não confirma cancelamento, estorno ou atendimento imediato.</p>
            <label className="block text-sm font-semibold">Contexto para o suporte
                <textarea readOnly value={message} rows={5} className="mt-2 w-full resize-y rounded-xl border border-line p-3 text-sm font-normal" />
            </label>
            <a href={supportWhatsAppUrl(message)} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] items-center justify-center rounded-xl bg-brand-700 text-white px-3 py-2 font-semibold">Abrir WhatsApp do suporte</a>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Motorista — ajuda durante corrida')}&body=${encodeURIComponent(message)}`}
                className="flex min-h-[44px] items-center justify-center text-sm underline">Abrir e-mail do suporte</a>
            <p className="text-xs text-ink-600">Você revisa e envia a mensagem no canal escolhido. WhatsApp e e-mail precisam de conexão; não desinstale o app para tentar resolver uma pendência.</p>
        </section>
        <button type="button" onClick={onClose} className="w-full min-h-[48px] rounded-xl border border-line font-semibold">Voltar à corrida</button>
    </div>
}
