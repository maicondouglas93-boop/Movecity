import React from 'react';
import { AlertTriangle } from 'lucide-react';

// Auditoria do painel administrativo (2026-08-02, Bloco F, §14): não existia
// tratamento global de erro — um erro de render em qualquer página derrubava a
// aplicação inteira numa tela branca sem explicação.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Erro não tratado no painel:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-sm text-center space-y-4">
            <AlertTriangle className="w-12 h-12 text-danger mx-auto" />
            <h1 className="text-xl font-bold text-text">Algo deu errado</h1>
            <p className="text-sm text-text-muted">
              Ocorreu um erro inesperado no painel. Recarregue a página para continuar — se o problema persistir, contate o suporte técnico.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-primary hover:bg-primary-hover text-surface px-6 py-2 rounded-lg font-medium transition-colors"
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
