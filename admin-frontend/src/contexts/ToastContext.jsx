import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';

const ToastContext = createContext(null);

let idCounter = 0;

// Auditoria do painel administrativo (2026-08-02, Bloco F): antes, sucesso/erro de
// mutation apareciam via alert() do navegador ou, em boa parte dos casos, não
// apareciam de jeito nenhum (25 mutations, só ~6 com onError). Este toast substitui
// os dois casos.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message, type) => {
    const id = ++idCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => remove(id), 6000);
  }, [remove]);

  const toast = {
    success: (message) => push(message, 'success'),
    error: (message) => push(message, 'error'),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-6 right-6 z-[3000] flex flex-col gap-2 w-full max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`flex items-start gap-3 px-4 py-3 rounded-lg shadow-2xl text-sm font-medium border animate-fade-in ${
              t.type === 'error'
                ? 'bg-danger/10 border-danger/30 text-danger'
                : 'bg-primary/10 border-primary/30 text-primary'
            }`}
          >
            {t.type === 'error' ? (
              <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
            )}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button onClick={() => remove(t.id)} aria-label="Fechar" className="text-current opacity-60 hover:opacity-100 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de ToastProvider');
  return ctx;
}
