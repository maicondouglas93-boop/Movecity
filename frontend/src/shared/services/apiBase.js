/**
 * Resolução única da URL da API.
 *
 * Auditoria de integração (2026-08-06): quando VITE_BASE_URL não é injetada no
 * build, `axios.create({ baseURL: undefined })` e `io(undefined)` não reclamam —
 * as chamadas viram relativas à origem do WebView (localhost) e o app falha com
 * "email ou senha incorretos" no login, sem nenhuma pista da causa real.
 *
 * Aqui a ausência vira um estado explícito que a UI sabe mostrar.
 */
const RAW_BASE_URL = import.meta.env.VITE_BASE_URL

function normalize(value) {
    const raw = String(value ?? '').trim()
    if (!raw || raw === 'undefined' || raw === 'null') return ''
    return raw.replace(/\/+$/, '')
}

export const API_BASE_URL = normalize(RAW_BASE_URL)

export function isApiBaseConfigured() {
    return API_BASE_URL.length > 0
}

/** Mensagem para a tela de erro de configuração (não expõe nada sensível). */
export function apiBaseConfigError() {
    if (isApiBaseConfigured()) return null
    return 'A URL do servidor não foi configurada neste build (VITE_BASE_URL).'
}

if (!isApiBaseConfigured()) {
    console.error(
        '[config] VITE_BASE_URL ausente — o app não tem endereço de backend. ' +
        'Build inválido para distribuição.'
    )
}
