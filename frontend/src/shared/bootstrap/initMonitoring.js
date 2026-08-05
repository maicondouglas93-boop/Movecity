import * as Sentry from '@sentry/react'

// Fase 2 da auditoria de production readiness (H3, 2026-08-05): o alvo de propagação
// de trace era o placeholder yourserver.io — nenhuma request de produção propagava o
// header de tracing pra API real. Deriva da MESMA variável que o cliente HTTP usa.
export function resolveTracePropagationTargets(env = import.meta.env) {
    const targets = ['localhost']
    try {
        const origin = new URL(env.VITE_BASE_URL).origin
        if (origin && !origin.includes('localhost')) targets.push(origin)
    } catch {
        // VITE_BASE_URL ausente/inválida: fica só o localhost — melhor não propagar
        // trace pra destino desconhecido do que propagar pro placeholder errado.
    }
    return targets
}

export function initMonitoring() {
    if (!import.meta.env.VITE_SENTRY_DSN) return

    // tracesSampleRate 1.0 em produção = 100% das transações com tracing — custo e
    // volume altos sem ganho proporcional. 0.1 por padrão, ajustável por env.
    const tracesSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE) || 0.1

    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration(),
        ],
        tracesSampleRate,
        tracePropagationTargets: resolveTracePropagationTargets(),
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
    })
}
