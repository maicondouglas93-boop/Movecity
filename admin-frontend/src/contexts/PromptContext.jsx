import React, { createContext, useCallback, useContext, useState } from 'react';

const PromptContext = createContext(null);

// Auditoria do painel administrativo (2026-08-02, Bloco F): substitui window.prompt(),
// usado pra capturar motivo de bloqueio/rejeição/cancelamento. Mesmo contrato de
// window.prompt (resolve string ao confirmar, null ao cancelar) — quem chamava com
// `if (reason !== null)` ou `if (reason)` continua funcionando sem mudar a lógica.
// `required: true` desabilita o botão de confirmar enquanto o campo estiver vazio,
// em vez de deixar pra validar depois (era isso que permitia motivo em branco passar
// em alguns pontos, ex.: handleBlock em Captains.jsx).
export function PromptProvider({ children }) {
  const [state, setState] = useState(null);
  const [value, setValue] = useState('');

  const prompt = useCallback((options) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    setValue(opts.defaultValue || '');
    return new Promise((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const handle = (result) => {
    state?.resolve(result);
    setState(null);
    setValue('');
  };

  const canConfirm = !state?.required || value.trim().length > 0;

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[3500] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => handle(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="bg-surface rounded-xl border border-border w-full max-w-sm shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 space-y-3">
              {state.title && <h2 className="font-semibold text-lg text-text">{state.title}</h2>}
              <label className="block text-sm text-text-muted" htmlFor="prompt-dialog-input">{state.message}</label>
              <textarea
                id="prompt-dialog-input"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && canConfirm) {
                    e.preventDefault();
                    handle(value.trim());
                  }
                }}
                rows={3}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-primary outline-none resize-none"
                placeholder={state.placeholder || ''}
              />
            </div>
            <div className="p-4 border-t border-border bg-background/50 flex justify-end gap-3">
              <button onClick={() => handle(null)} className="px-4 py-2 text-text-muted hover:text-text font-medium text-sm transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => handle(value.trim())}
                disabled={!canConfirm}
                className="px-4 py-2 rounded-lg font-medium text-sm text-white bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {state.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PromptContext.Provider>
  );
}

export function usePrompt() {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error('usePrompt deve ser usado dentro de PromptProvider');
  return ctx;
}
