import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { ShieldAlert, Info } from 'lucide-react';

const fetchLogs = async ({ queryKey }) => {
  const [_key, page] = queryKey;
  const { data } = await api.get(`/admin/logs?page=${page}`);
  return data;
};

export default function Logs() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['logs', page],
    queryFn: fetchLogs,
    keepPreviousData: true
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Logs & Auditoria</h1>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-background/50 border-b border-border text-text-muted">
              <tr>
                <th className="px-6 py-4 font-medium">Data/Hora</th>
                <th className="px-6 py-4 font-medium">Administrador</th>
                <th className="px-6 py-4 font-medium">Ação</th>
                <th className="px-6 py-4 font-medium">Alvo (Modelo)</th>
                <th className="px-6 py-4 font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan="5" className="px-6 py-8 text-center text-text-muted">Carregando...</td></tr>
              ) : isError ? (
                <tr><td colSpan="5" className="px-6 py-8 text-center text-danger">Erro ao carregar dados.</td></tr>
              ) : data?.logs?.length === 0 ? (
                <tr><td colSpan="5" className="px-6 py-8 text-center text-text-muted">Nenhum log encontrado.</td></tr>
              ) : (
                data?.logs?.map((log) => (
                  <tr key={log._id} className="hover:bg-background/50 transition-colors">
                    <td className="px-6 py-4 text-text-muted whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 font-medium flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-primary" />
                      {log.adminName}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-background border border-border text-text-muted uppercase tracking-wider">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-text-muted">
                      {log.targetModel} <span className="font-mono text-xs opacity-50 ml-1">({log.targetId?.slice(-6)})</span>
                    </td>
                    <td className="px-6 py-4 text-text-muted max-w-xs truncate" title={log.reason}>
                      {log.reason || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {data?.pages > 1 && (
          <div className="px-6 py-4 border-t border-border flex items-center justify-between">
            <span className="text-sm text-text-muted">Página {page} de {data.pages} (Total: {data.total})</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-background border border-border rounded hover:bg-border transition-colors disabled:opacity-50">Anterior</button>
              <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page === data.pages} className="px-3 py-1 bg-background border border-border rounded hover:bg-border transition-colors disabled:opacity-50">Próxima</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
