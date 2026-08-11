import React, { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import api from '../services/api';
import { ShieldAlert, Search, X, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDateTime } from '../utils/format';

// Auditoria de UX/produção (2026-08-10): 'VehicleCategory' nunca esteve nesta lista,
// mas schedule_tariff (admin.controller.js) grava targetModel:'VehicleCategory' de
// verdade — logs desse tipo nunca podiam ser filtrados pelo select "Alvo". 'GlobalTariff'
// adicionado junto com a auditoria de Tarifas Globais (globalTariff.controller.js), que
// antes mutava sem nenhum rastro em AdminLog.
const TARGET_MODELS = ['Captain', 'User', 'Ride', 'Payout', 'Promotion', 'NotificationCampaign', 'Notification', 'TariffSetting', 'VehicleCategory', 'GlobalTariff'];

// Dicionário de tradução das ~25 ações que este sistema de log realmente grava
// (levantado direto em Backend/services/admin.service.js e admin.controller.js,
// toda chamada a adminService.logAction) — antes a coluna "Ação" mostrava a string
// técnica crua (ex.: "MANUAL_WALLET_ADJUSTMENT", "bulk_block_users").
const ACTION_LABELS = {
  bulk_block_users: 'Bloqueio em lote (passageiros)',
  bulk_unblock_users: 'Desbloqueio em lote (passageiros)',
  block_user: 'Bloqueio de passageiro',
  unblock_user: 'Desbloqueio de passageiro',
  update_user_tags: 'Atualização de tags do passageiro',
  add_user_observation: 'Observação adicionada ao passageiro',
  update_captain_approval: 'Aprovação/reprovação de motorista',
  block_captain: 'Bloqueio de motorista',
  unblock_captain: 'Desbloqueio de motorista',
  reset_captain_password: 'Redefinição de senha do motorista',
  update_captain_vehicle: 'Atualização de veículo do motorista',
  upload_captain_document: 'Envio de documento do motorista',
  MANUAL_WALLET_ADJUSTMENT: 'Ajuste manual de saldo',
  cancel_ride: 'Cancelamento de corrida',
  reassign_ride: 'Reatribuição de corrida',
  bulk_cancel_rides: 'Cancelamento em lote de corridas',
  admin_finalize_ride: 'Finalização manual de corrida',
  approve_payout: 'Aprovação de repasse',
  confirm_payout_paid: 'Confirmação de pagamento de repasse',
  reject_payout: 'Rejeição de repasse',
  bulk_approve_payouts: 'Aprovação em lote de repasses',
  send_notification: 'Envio de notificação',
  create_campaign: 'Criação de campanha de notificação',
  cancel_campaign: 'Cancelamento de campanha de notificação',
  update_promotion_status: 'Alteração de status de promoção',
  update_tariff: 'Atualização de tarifas',
  schedule_tariff: 'Agendamento de tarifas',
  create_global_tariff: 'Criação de tarifa global',
  update_global_tariff: 'Atualização de tarifa global',
  delete_global_tariff: 'Remoção de tarifa global',
};

function actionLabel(action) {
  return ACTION_LABELS[action] || action;
}

function formatValue(value) {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

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
  const [expandedId, setExpandedId] = useState(null);

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
          {/* Auditoria de UX/produção (2026-08-10): ícone era só decorativo (sem
              onClick) — este era o único filtro que exigia apertar Enter, sem
              nenhum indicativo visual disso. Agora é o botão de submit de verdade. */}
          <button type="submit" className="absolute left-3 top-8.5" aria-label="Buscar">
            <Search className="w-4 h-4 text-text-muted" />
          </button>
          <input
            type="text"
            placeholder="Buscar por nome..."
            value={adminNameInput}
            onChange={(e) => setAdminNameInput(e.target.value)}
            className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </form>

        <div className="min-w-52">
          <label className="block text-xs font-medium text-text-muted mb-1">Ação</label>
          {/* Auditoria de UX/produção (2026-08-10): era um campo de texto livre com
              placeholder "ex: block_user" — obrigava o admin a adivinhar/lembrar a
              string técnica interna. Select com os nomes traduzidos. */}
          <select
            value={filters.action}
            onChange={(e) => updateFilter('action', e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            <option value="">Todas</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
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
                <th className="px-6 py-4 font-medium w-8"></th>
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
                <tr><td colSpan="7" className="px-6 py-8 text-center text-text-muted">Carregando...</td></tr>
              ) : isError ? (
                <tr><td colSpan="7" className="px-6 py-8 text-center text-danger">Erro ao carregar dados.</td></tr>
              ) : data?.logs?.length === 0 ? (
                <tr><td colSpan="7" className="px-6 py-8 text-center text-text-muted">{hasActiveFilters ? 'Nenhum log encontrado para esses filtros.' : 'Nenhum log encontrado.'}</td></tr>
              ) : (
                data?.logs?.map((log) => {
                  // Auditoria de UX/produção (2026-08-10): oldValue/newValue já
                  // existem no schema (adminLog.model.js) e já vinham na resposta da
                  // API, mas a tela nunca renderizava — "o que exatamente mudou" é a
                  // pergunta central de qualquer investigação de disputa, e não tinha
                  // resposta nenhuma. Linha expansível, só quando há algo pra mostrar.
                  const hasDetail = log.oldValue !== undefined || log.newValue !== undefined;
                  const isExpanded = expandedId === log._id;
                  return (
                    <React.Fragment key={log._id}>
                      <tr
                        className={`transition-colors ${hasDetail ? 'cursor-pointer hover:bg-background/50' : ''}`}
                        onClick={() => hasDetail && setExpandedId(isExpanded ? null : log._id)}
                      >
                        <td className="px-6 py-4 text-text-muted">
                          {hasDetail && (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                        </td>
                        <td className="px-6 py-4 text-text-muted whitespace-nowrap">
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className="px-6 py-4 font-medium">
                          <span className="flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4 text-primary" />
                            {log.adminName}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-background border border-border text-text-muted uppercase tracking-wider">
                            {actionLabel(log.action)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-text-muted" title={log.targetId}>
                          {log.targetModel} <span className="font-mono text-xs opacity-50 ml-1">({log.targetId?.slice(-6)})</span>
                        </td>
                        <td className="px-6 py-4 text-text-muted max-w-xs truncate" title={log.reason}>
                          {log.reason || '-'}
                        </td>
                        <td className="px-6 py-4 text-text-muted font-mono text-xs">
                          {log.ipAddress || '-'}
                        </td>
                      </tr>
                      {isExpanded && hasDetail && (
                        <tr className="bg-background/30">
                          <td colSpan="7" className="px-6 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              <div>
                                <p className="font-bold uppercase tracking-wider text-text-muted mb-1">Antes</p>
                                <pre className="bg-background border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono">{formatValue(log.oldValue)}</pre>
                              </div>
                              <div>
                                <p className="font-bold uppercase tracking-wider text-text-muted mb-1">Depois</p>
                                <pre className="bg-background border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono">{formatValue(log.newValue)}</pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
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
