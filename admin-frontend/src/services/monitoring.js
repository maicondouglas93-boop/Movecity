import * as Sentry from '@sentry/react';

// Fase 2 da auditoria de production readiness (H3, 2026-08-05): o painel não tinha
// NENHUMA observabilidade de cliente — o ErrorBoundary só fazia console.error, então
// um crash em produção morria no DevTools de quem estava olhando. Mesmo desenho do
// app do passageiro/motorista: DSN via env, desligado quando ausente.
export function resolveTracePropagationTargets(env = import.meta.env) {
  const targets = ['localhost'];
  try {
    const origin = new URL(env.VITE_API_URL).origin;
    if (origin && !origin.includes('localhost')) targets.push(origin);
  } catch {
    // VITE_API_URL ausente/inválida: só localhost.
  }
  return targets;
}

export function initMonitoring() {
  if (!import.meta.env.VITE_SENTRY_DSN) return;

  const tracesSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE) || 0.1;

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate,
    tracePropagationTargets: resolveTracePropagationTargets(),
  });
}
