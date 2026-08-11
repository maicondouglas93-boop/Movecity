import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { Clock, User } from 'lucide-react';
import { formatDateTime } from '../utils/format';

// Auditoria de UX/produção (2026-08-10): String(val) num campo objeto (ex.: "pricing",
// que é um objeto aninhado com base/km/minuto/comissão/adicionais) produz literalmente
// o texto "[object Object]" — o campo mais importante pra auditar (o que mudou na
// precificação) renderizava ilegível. JSON formatado em vez de String().
function formatDiffValue(val) {
  if (val === undefined || val === null) return '0';
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}

export default function TariffHistory({ categoryId, categoryName }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ['tariffHistory', categoryId],
    queryFn: async () => {
      const url = categoryId 
        ? `/admin/tariffs/history?categoryId=${categoryId}` 
        : `/admin/tariffs/history`;
      const { data } = await api.get(url);
      return data;
    }
  });

  if (isLoading) return <div className="text-text-muted text-sm py-4">Carregando histórico...</div>;
  if (!history || history.length === 0) return null;

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden mt-6">
      <div className="bg-background/50 border-b border-border p-4 flex items-center gap-2">
        <Clock className="w-5 h-5 text-text-muted" />
        <h3 className="font-semibold text-lg">Últimas Alterações {categoryName ? `- ${categoryName}` : ''}</h3>
      </div>
      
      <div className="divide-y divide-border">
        {history.map((log) => (
          <div key={log._id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2 flex-1">
              {log.action === 'create' ? (
                <div className="text-sm font-medium text-text">Categoria criada/duplicada</div>
              ) : (
                <div className="space-y-1">
                  {Object.entries(log.newValue || {}).map(([key, val]) => {
                    const oldVal = log.oldValue?.[key];
                    // Só mostra o que mudou
                    if (JSON.stringify(oldVal) !== JSON.stringify(val) && key !== '_id' && key !== 'updatedAt') {
                      const isObj = typeof val === 'object' && val !== null;
                      return (
                        <div key={key} className={isObj ? 'text-sm space-y-1' : 'text-sm flex items-center gap-2'}>
                          <span className="font-medium capitalize text-text-muted">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                          {isObj ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                              <pre className="bg-background border border-border rounded-lg p-2 text-xs overflow-x-auto whitespace-pre-wrap text-danger/80 line-through decoration-danger/40">{formatDiffValue(oldVal)}</pre>
                              <pre className="bg-background border border-border rounded-lg p-2 text-xs overflow-x-auto whitespace-pre-wrap text-primary">{formatDiffValue(val)}</pre>
                            </div>
                          ) : (
                            <>
                              <span className="line-through text-danger opacity-70">{formatDiffValue(oldVal)}</span>
                              <span className="text-text-muted">→</span>
                              <span className="text-primary font-medium">{formatDiffValue(val)}</span>
                            </>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              )}
            </div>
            
            <div className="flex flex-col items-end text-xs text-text-muted border-l border-border pl-4">
              <div className="flex items-center gap-1 mb-1">
                <User className="w-3.5 h-3.5" />
                <span>{log.admin}</span>
              </div>
              <div>{formatDateTime(log.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
