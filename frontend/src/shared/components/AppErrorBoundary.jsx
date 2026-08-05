import React from 'react'
import * as Sentry from '@sentry/react'

// Fase 1 da auditoria de production readiness (C2, 2026-08-05): o painel admin já
// tinha ErrorBoundary (admin-frontend/src/components/ErrorBoundary.jsx), mas o app do
// passageiro/motorista não — um erro de render em corrida/mapa derrubava tudo numa
// tela branca sem recuperação. Instalado no topo de main.jsx e main.driver.jsx, FORA
// dos providers: assim um crash dentro de qualquer provider também é capturado. O
// fallback não depende de router/contexts de propósito — só HTML + reload.
//
// Sentry: captureException é no-op seguro quando initMonitoring() não inicializou
// (sem VITE_SENTRY_DSN) — não cria um segundo Sentry.init aqui.
export default class AppErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError() {
        return { hasError: true }
    }

    componentDidCatch(error, info) {
        console.error('[AppErrorBoundary] Erro não tratado no app:', error, info)
        try {
            Sentry.captureException(error, {
                contexts: { react: { componentStack: info?.componentStack } },
            })
        } catch {
            // Monitoramento nunca pode impedir o fallback de aparecer.
        }
    }

    render() {
        if (this.state.hasError) {
            // Sem stack trace, tokens ou dados internos — só orientação de recuperação.
            return (
                <div className="min-h-screen flex items-center justify-center bg-white p-6">
                    <div className="max-w-sm text-center space-y-4">
                        <div className="text-5xl" aria-hidden="true">⚠️</div>
                        <h1 className="text-xl font-bold text-gray-900">Algo deu errado</h1>
                        <p className="text-sm text-gray-600">
                            Ocorreu um erro inesperado no aplicativo. Toque no botão abaixo
                            para recarregar — se o problema persistir, feche e abra o app
                            novamente.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="bg-black text-white px-6 py-3 rounded-lg font-medium w-full"
                        >
                            Recarregar aplicativo
                        </button>
                    </div>
                </div>
            )
        }
        // eslint-disable-next-line react/prop-types
        return this.props.children
    }
}
