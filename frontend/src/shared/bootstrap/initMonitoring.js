import * as Sentry from '@sentry/react'

// Cópia mecânica do init que vivia em main.jsx — sem alterar opções.
export function initMonitoring() {
    if (!import.meta.env.VITE_SENTRY_DSN) return

    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration(),
        ],
        tracesSampleRate: 1.0,
        tracePropagationTargets: ['localhost', /^https:\/\/yourserver\.io\/api/],
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
    })
}
