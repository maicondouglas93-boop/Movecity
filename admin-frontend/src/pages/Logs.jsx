import React, { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import api from '../services/api';
import { ShieldAlert, Search, X } from 'lucide-react';

const TARGET_MODELS = ['Captain', 'User', 'Ride', 'Payout', 'Promotion', 'NotificationCampaign', 'Notification', 'TariffSetting'];

const fetchLogs = async ({ queryKey }) => {
  const [_key, page, filters] = queryKey;
  const params = new URLSearchParams({ page, limit: 15 });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const { data } = await api.get(`/admin/logs?${params.toString()}`);
  return data;
};

// Bloco I (2026-08-02, §12): antes esta tela não tinha filtro nenhum — só paginação.
// Em qualquer volume real de ações administrativas, encontrar um evento específico
// (quem bloqueou este motorista? quem mudou esta tarifa?) era praticamente impossível.
export default function Logs() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ adminName: '', action: '', targetModel: '', startDate: '', endDate: '' });
  const [adminNameInput, setAdminNameInput] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['logs', page, filters],
    queryFn: fetchLogs,
    placeholderData: keepPreviousData
  });

  const handleSearch = (e) => {
    e.preventDefault();
    setFilters((f) => ({ ...f, adminName: adminNameInput }));
    setPage(1);
  };

  const updateFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({ adminName: '', action: '', targetModel: '', startDate: '', endDate: '' });
    setAdminNameInput('');
    setPage(1);
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Logs & Auditoria</h1>
      </div>

      <div className="bg-surface rounded-xl border border-border p-4 flex flex-wrap items-end gap-3">
        <form onSubmit={handleSearch} className="relative flex-1 min-w-50">
          <label className="block text-xs font-medium text-text-muted mb-1">Administrador</label>
          <Search className="absolute left-3 top-8.5 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Buscar por nome..."
            value={adminNameInput}
            onChange={(e) => setAdminNameInput(e.target.value)}
            className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </form>

        <div className="min-w-40">
          <label className="block text-xs font-medium text-text-muted mb-1">Ação</label>
          <input
            type="text"
            placeholder="ex: block_user"
            value={filters.action}
            onChange={(e) => updateFilter('action', e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>

        <div className="min-w-40">
          <label className="block text-xs font-medium text-text-muted mb-1">Alvo</label>
          <select
            value={filters.targetModel}
            onChange={(e) => updateFilter('targetModel', e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            <option value="">Todos</option>
            {TARGET_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">De</label>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => updateFilter('startDate', e.target.value)}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Até</label>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => updateFilter('endDate', e.target.value)}
            className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
          />
        </div>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-text-muted hover:text-danger transition-colors"
          >
            <X className="w-4 h-4" /> Limpar filtros
          </button>
        )}
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
                <th className="px-6 py-4 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan="6" className="px-6 py-8 text-center text-text-muted">Carregando...</td></tr>
              ) : isError ? (
                <tr><td colSpan="6" className="px-6 py-8 text-center text-danger">Erro ao carregar dados.</td></tr>
              ) : data?.logs?.length === 0 ? (
                <tr><td colSpan="6" className="px-6 py-8 text-center text-text-muted">{hasActiveFilters ? 'Nenhum log encontrado para esses filtros.' : 'Nenhum log encontrado.'}</td></tr>
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
                    <td className="px-6 py-4 text-text-muted font-mono text-xs">
                      {log.ipAddress || '-'}
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
