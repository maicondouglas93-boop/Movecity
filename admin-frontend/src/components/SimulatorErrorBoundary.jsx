import React from 'react';
import { AlertTriangle } from 'lucide-react';

/** Isola crash do simulador para não derrubar a página Tarifas inteira. */
export default class SimulatorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[SimulatorErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-surface rounded-xl border border-border p-6 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
          <div className="text-sm font-medium text-text">Simulador indisponível</div>
          <div className="text-xs text-text-muted">
            A edição de tarifas continua funcionando. Recarregue se quiser tentar o simulador de novo.
          </div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="text-sm text-primary hover:underline"
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
