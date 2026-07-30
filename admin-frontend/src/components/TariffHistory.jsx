import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { Clock, User } from 'lucide-react';

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
                      return (
                        <div key={key} className="text-sm flex items-center gap-2">
                          <span className="font-medium capitalize text-text-muted">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                          <span className="line-through text-danger opacity-70">{String(oldVal || 0)}</span>
                          <span className="text-text-muted">→</span>
                          <span className="text-success font-medium">{String(val)}</span>
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
              <div>{new Date(log.createdAt).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
