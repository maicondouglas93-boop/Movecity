// Fase 2 da auditoria de production readiness (H7, 2026-08-05): os logs [AUDIT] dos
// fluxos de corrida imprimiam IDs de corrida, pickup/destino e eventos de socket no
// DevTools de usuários reais — PII operacional em produção, já que o build do Vite
// não faz drop_console. Estes helpers só emitem em dev (import.meta.env.DEV); em
// produção viram no-op e o minificador elimina as chamadas mortas.
const enabled = import.meta.env.DEV

export const devLog = (...args) => { if (enabled) console.log(...args) }
export const devWarn = (...args) => { if (enabled) console.warn(...args) }
export const devError = (...args) => { if (enabled) console.error(...args) }
