import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

const ConfirmContext = createContext(null);

// Auditoria do painel administrativo (2026-08-02, Bloco F): substitui window.confirm()
// nas 29 ocorrências espalhadas pelas páginas — mesmo formato de chamada (uma promise
// que resolve true/false), só a aparência muda de diálogo do SO pra modal do app.
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = useCallback((options) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    return new Promise((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const handle = (result) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[3500] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => handle(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="bg-surface rounded-xl border border-border w-full max-w-sm shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 flex gap-3">
              {state.tone === 'danger' && <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />}
              <div>
                {state.title && <h2 className="font-semibold text-lg text-text mb-1">{state.title}</h2>}
                <p className="text-sm text-text-muted whitespace-pre-line">{state.message}</p>
              </div>
            </div>
            <div className="p-4 border-t border-border bg-background/50 flex justify-end gap-3">
              <button onClick={() => handle(false)} className="px-4 py-2 text-text-muted hover:text-text font-medium text-sm transition-colors">
                {state.cancelLabel || 'Cancelar'}
              </button>
              <button
                onClick={() => handle(true)}
                autoFocus
                className={`px-4 py-2 rounded-lg font-medium text-sm text-white transition-colors ${
                  state.tone === 'danger' ? 'bg-danger hover:bg-danger/90' : 'bg-primary hover:bg-primary-hover'
                }`}
              >
                {state.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm deve ser usado dentro de ConfirmProvider');
  return ctx;
}
