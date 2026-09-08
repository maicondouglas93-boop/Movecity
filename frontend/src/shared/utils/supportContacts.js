import { buildWhatsAppUrl } from '@/shared/utils/whatsapp'

// Contatos já publicados na página de suporte. Nenhum canal novo de atendimento.
export const SUPPORT_EMAIL = 'maicondouglas93@gmail.com'
export const SUPPORT_PHONE = '5533998680141'
export const supportWhatsAppUrl = message => buildWhatsAppUrl(import.meta.env.VITE_SUPPORT_WHATSAPP, message) || buildWhatsAppUrl(SUPPORT_PHONE, message)
export const supportEmailUrl = message => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Motorista — finalização pendente')}&body=${encodeURIComponent(message)}`
