import LegalPage from './LegalPage'

const PublicSupport = () => (
  <LegalPage title="Suporte MoveCity">
    <p className="text-ink-600 leading-6 mb-6">Fale com o suporte para dúvidas sobre conta, corridas, encomendas, pagamentos, privacidade ou exclusão de dados.</p>
    <div className="space-y-4">
      <a href="mailto:maicondouglas93@gmail.com" className="flex items-center gap-4 rounded-panel border border-line p-4 active:bg-surface-alt">
        <i className="ri-mail-line text-2xl text-brand-600" aria-hidden="true" />
        <span><strong className="block">E-mail</strong><span className="text-sm text-ink-600">maicondouglas93@gmail.com</span></span>
      </a>
      <a href="https://wa.me/5533998680141" className="flex items-center gap-4 rounded-panel border border-line p-4 active:bg-surface-alt">
        <i className="ri-whatsapp-line text-2xl text-brand-600" aria-hidden="true" />
        <span><strong className="block">WhatsApp</strong><span className="text-sm text-ink-600">+55 33 99868-0141</span></span>
      </a>
    </div>
    <div className="mt-7 rounded-panel bg-surface-alt p-4 text-sm leading-6 text-ink-600">Atendimento do MoveCity — Lajinha, Minas Gerais. Ao entrar em contato, informe se sua conta é de passageiro ou motorista e descreva o problema sem enviar senhas.</div>
  </LegalPage>
)

export default PublicSupport
