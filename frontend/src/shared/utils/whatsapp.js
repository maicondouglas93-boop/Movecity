/**
 * Monta URL do WhatsApp a partir de um telefone BR (ou E.164 parcial).
 * Retorna null se não houver dígitos suficientes.
 */
export function buildWhatsAppUrl(phone, message) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length < 8) return null

  let e164 = digits
  if (!e164.startsWith('55') && (e164.length === 10 || e164.length === 11)) {
    e164 = `55${e164}`
  }

  const url = new URL(`https://wa.me/${e164}`)
  if (message) url.searchParams.set('text', message)
  return url.toString()
}

export function openWhatsApp(phone, message) {
  const url = buildWhatsAppUrl(phone, message)
  if (!url) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
