import React, { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import api from '../services/api';
import {
  Search, CheckCircle, XCircle, MoreVertical, ShieldAlert,
  Wallet, ArrowUpRight, Clock, Building, Download, Square, CheckSquare, X, AlertTriangle, Landmark, Users as UsersIcon
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, CartesianGrid } from 'recharts';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePrompt } from '../contexts/PromptContext';
import { buildCsv, downloadCsv } from '../utils/csv';
import { formatMoney, formatDateTime } from '../utils/format';
import { PAYOUT_STATUS_LABELS, PAYOUT_STATUS_COLORS, statusLabel, statusColor } from '../utils/statusDictionary';
import { describeCaptainLedgerTx, ledgerToneClass } from '../utils/captainLedgerDisplay';
import StatusBadge from '../components/StatusBadge';

// Auditoria de UX (2026-08-10): a tela misturava dinheiro da plataforma (comissão),
// dinheiro do motorista (repasses/saldo) e contadores operacionais (rejeitados/
// atrasados) numa grade única, sem indicar o que é o quê. Reorganizado em duas
// seções visuais: Resumo Financeiro (plataforma) e Financeiro dos Motoristas.
export default function Finance() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ period: 'all', status: searchParams.get('status') || '', search: '' });
  const [searchInput, setSearchInput] = useState('');
  const [selectedPayouts, setSelectedPayouts] = useState([]);
  const [activePayoutDrawer, setActivePayoutDrawer] = useState(null);

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['payouts', page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ page, limit: 15, ...filters });
      const { data } = await api.get(`/admin/payouts?${params.toString()}`);
      return data;
    },
    placeholderData: keepPreviousData
  });

  const handleSearch = (e) => {
    e.preventDefault();
    setFilters(prev => ({ ...prev, search: searchInput }));
    setPage(1);
  };

  const toggleSelectAll = () => {
    if (selectedPayouts.length === data?.payouts?.length) {
      setSelectedPayouts([]);
    } else {
      setSelectedPayouts(data?.payouts?.map(p => p._id) || []);
    }
  };

  const toggleSelect = (id) => {
    setSelectedPayouts(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const bulkApproveMutation = useMutation({
    mutationFn: async (payoutIds) => {
      const { data } = await api.post(`/admin/payouts/bulk-approve`, { payoutIds });
      return data;
    },
    onSuccess: (res) => {
      toast.success(`Sucesso! ${res.approvedCount} repasses foram aprovados.`);
      setSelectedPayouts([]);
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || err.message || 'Erro ao aprovar repasses em lote');
    }
  });

  const exportCSV = () => {
    if (!data?.payouts) return;
    const items = selectedPayouts.length > 0 ? data.payouts.filter(p => selectedPayouts.includes(p._id)) : data.payouts;

    const csvUri = buildCsv(
      ['ID', 'Motorista', 'Valor', 'ChavePix', 'Status', 'Data'],
      items.map(p => [p._id, p.captainId?.fullname?.firstname, p.amount, p.captainId?.pixKey, statusLabel(PAYOUT_STATUS_LABELS, p.status), new Date(p.createdAt).toISOString()])
    );
    downloadCsv(csvUri, `financeiro_${new Date().getTime()}.csv`);
  };

  const chartData = data?.chartSeries?.length
    ? data.chartSeries
    : [
        { name: 'Seg', valor: 0 },
        { name: 'Ter', valor: 0 },
        { name: 'Qua', valor: 0 },
        { name: 'Qui', valor: 0 },
        { name: 'Sex', valor: 0 },
        { name: 'Sáb', valor: 0 },
        { name: 'Dom', valor: 0 },
      ];

  return (
    <div className="flex h-[calc(100vh-6rem)] overflow-hidden bg-background">
      <div className="flex flex-col flex-1 w-full transition-all duration-300">

        {/* Header & Dashboard Stats */}
        <div className="p-6 border-b border-border space-y-6 flex-shrink-0 bg-surface overflow-y-auto max-h-[60vh]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Centro Financeiro</h1>
              <p className="text-sm text-text-muted mt-1">Comissão da plataforma, repasses e saques dos motoristas.</p>
            </div>
          </div>

          {isError && (
            <div className="bg-danger/10 border border-danger/30 text-danger rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-3">
              <span>{error?.response?.data?.message || error?.message || 'Falha ao carregar o financeiro.'}</span>
              <button
                type="button"
                onClick={() => refetch()}
                className="px-3 py-1 rounded-lg border border-danger/40 text-xs font-semibold"
              >
                {isRefetching ? 'Tentando…' : 'Tentar de novo'}
              </button>
            </div>
          )}

          {data?.summary && (
            <div className="space-y-5">
              {/* RESUMO FINANCEIRO — dinheiro da plataforma */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5"><Landmark className="w-3.5 h-3.5" /> Resumo financeiro (plataforma)</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-background border border-border px-4 py-4 rounded-xl flex flex-col">
                    <div className="flex items-center gap-2 mb-2 text-text-muted"><Wallet className="w-4 h-4" /><p className="text-sm font-medium">Comissão acumulada (total)</p></div>
                    <p className="text-2xl font-bold">{formatMoney(data.summary.platformBalance)}</p>
                    <p className="text-xs text-text-muted mt-1">
                      Mês {formatMoney(data.summary.commissionMonth)} · hoje {formatMoney(data.summary.commissionToday)}
                    </p>
                  </div>
                  <div className="bg-background border border-border px-4 py-4 rounded-xl flex flex-col">
                    <div className="flex items-center gap-2 mb-2 text-primary"><ArrowUpRight className="w-4 h-4" /><p className="text-sm font-medium">Repassado hoje</p></div>
                    <p className="text-2xl font-bold">{formatMoney(data.summary.paidToday)}</p>
                    <p className="text-xs text-text-muted mt-1">Volume liberado hoje</p>
                  </div>
                  <div className="bg-background border border-border px-4 py-4 rounded-xl flex flex-col">
                    <div className="flex items-center gap-2 mb-2 text-primary"><ArrowUpRight className="w-4 h-4" /><p className="text-sm font-medium">Repassado no mês</p></div>
                    <p className="text-2xl font-bold">{formatMoney(data.summary.paidMonth)}</p>
                    <p className="text-xs text-text-muted mt-1">Total do mês</p>
                  </div>
                </div>
              </div>

              {/* FINANCEIRO DOS MOTORISTAS — repasses/pendências */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5"><UsersIcon className="w-3.5 h-3.5" /> Financeiro dos motoristas (repasses)</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-background border border-border px-4 py-4 rounded-xl flex flex-col">
                    <div className="flex items-center gap-2 mb-2 text-warning"><Clock className="w-4 h-4" /><p className="text-sm font-medium">Repasses pendentes</p></div>
                    <p className="text-2xl font-bold">{formatMoney(data.summary.pendingAmount)}</p>
                    <p className="text-xs text-text-muted mt-1">Saídas previstas, ainda não pagas</p>
                  </div>
                  <div className="bg-background border border-border px-4 py-4 rounded-xl flex flex-col">
                    <div className="flex items-center gap-2 mb-2 text-danger"><XCircle className="w-4 h-4" /><p className="text-sm font-medium">Rejeitados</p></div>
                    <p className="text-2xl font-bold">{data.summary.rejectedCount || 0}</p>
                    <p className="text-xs text-text-muted mt-1">Solicitações com erro</p>
                  </div>
                  <div className={`bg-background border px-4 py-4 rounded-xl flex flex-col ${data.summary.overdueCount > 0 ? 'border-warning/40' : 'border-border'}`}>
                    <div className={`flex items-center gap-2 mb-2 ${data.summary.overdueCount > 0 ? 'text-warning' : 'text-text-muted'}`}><AlertTriangle className="w-4 h-4" /><p className="text-sm font-medium">Atrasados</p></div>
                    <p className="text-2xl font-bold">{data.summary.overdueCount || 0}</p>
                    <p className="text-xs text-text-muted mt-1">Sem aprovação há mais de {data.summary.payoutDeadlineDays ?? 2} dias</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Gráfico real — comissões dos últimos 7 dias */}
          <div className="h-32 w-full bg-background border border-border rounded-xl p-2 hidden md:block">
            <p className="text-[10px] uppercase tracking-wide text-text-muted px-2 pt-1">Comissões da plataforma — últimos 7 dias</p>
            <ResponsiveContainer width="100%" height="85%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorValor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value, key) => [
                    formatMoney(value),
                    key === 'valor' || key === 'commission' ? 'Comissão' : key === 'payouts' ? 'Saques pagos' : key,
                  ]}
                />
                <Area type="monotone" dataKey="valor" stroke="#3b82f6" fillOpacity={1} fill="url(#colorValor)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {/* Auditoria de UX (2026-08-10): gráfico some no mobile (hidden md:block) sem
              nenhum substituto — mantido assim por ora (troca por outra visualização é
              escopo maior), mas os cards acima já cobrem os mesmos números em texto. */}

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <form onSubmit={handleSearch} className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Buscar (Motorista, Chave)..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
            </form>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.period} onChange={e => { setFilters(f => ({ ...f, period: e.target.value })); setPage(1); }}>
              <option value="all">Todo o período</option>
              <option value="today">Hoje</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}>
              <option value="">Status (Todos)</option>
              <option value="requested">Solicitado</option>
              <option value="in_analysis">Em Análise</option>
              <option value="approved">Aprovado</option>
              <option value="processing">Processando (debitado, aguardando PIX)</option>
              <option value="paid">Pago</option>
              <option value="rejected">Rejeitado</option>
            </select>
          </div>

          {/* Bulk Actions */}
          {selectedPayouts.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-lg animate-fade-in">
              <span className="text-sm font-medium text-primary">{selectedPayouts.length} selecionados</span>
              <div className="h-4 w-px bg-primary/20"></div>
              <button
                onClick={async () => {
                  if (await confirm(`Aprovar e processar ${selectedPayouts.length} repasses selecionados?`)) {
                    bulkApproveMutation.mutate(selectedPayouts);
                  }
                }}
                disabled={bulkApproveMutation.isPending}
                className="text-sm px-3 py-1 bg-primary text-background rounded font-medium flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" /> {bulkApproveMutation.isPending ? 'Aprovando...' : 'Aprovar Selecionados'}
              </button>
              <button onClick={exportCSV} className="text-sm px-3 py-1 bg-background rounded border border-border flex items-center gap-2 hover:bg-background/80">
                <Download className="w-4 h-4" /> Exportar CSV
              </button>
            </div>
          )}
        </div>

        {/* List / Table */}
        <div className="flex-1 overflow-auto bg-background">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-surface sticky top-0 border-b border-border text-text-muted z-10">
              <tr>
                <th className="px-4 py-3 w-10 text-center">
                  <button onClick={toggleSelectAll}>
                    {selectedPayouts.length > 0 && selectedPayouts.length === data?.payouts?.length ?
                      <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Data / ID</th>
                <th className="px-4 py-3 font-medium">Motorista / Chave Pix</th>
                <th className="px-4 py-3 font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan="6" className="px-6 py-8 text-center text-text-muted">Carregando...</td></tr>
              ) : data?.payouts?.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-8 text-center text-text-muted">
                    Nenhum pedido de saque encontrado.
                    {(data?.summary?.platformBalance > 0) && (
                      <span className="block mt-1 text-xs">
                        Há comissões registradas — a lista abaixo só mostra solicitações de repasse dos motoristas.
                      </span>
                    )}
                  </td>
                </tr>
              ) : (
                data?.payouts?.map((payout) => {
                  const isSelected = selectedPayouts.includes(payout._id);
                  return (
                    <tr key={payout._id} onClick={() => setActivePayoutDrawer(payout)} className={`cursor-pointer hover:bg-surface/50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}>
                      <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => toggleSelect(payout._id)}>
                          {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-text-muted" />}
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-text font-medium">{formatDateTime(payout.createdAt)}</p>
                        <p className="text-xs text-text-muted mt-0.5">#{payout._id.substring(18).toUpperCase()}</p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center shrink-0 text-xs font-bold text-text-muted uppercase">
                            {payout.captainId?.fullname?.firstname?.charAt(0) || '?'}
                          </div>
                          <div>
                            <p className="font-medium text-text">{payout.captainId?.fullname?.firstname} {payout.captainId?.fullname?.lastname}</p>
                            <p className="text-xs text-text-muted mt-0.5 font-mono">{payout.captainId?.pixKey || 'Chave não informada'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-bold text-text">{formatMoney(payout.amount)}</p>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge colorClass={statusColor(PAYOUT_STATUS_COLORS, payout.status)} label={statusLabel(PAYOUT_STATUS_LABELS, payout.status)} />
                      </td>
                      <td className="px-4 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setActivePayoutDrawer(payout)} className="p-1.5 hover:bg-background border border-transparent hover:border-border rounded transition-colors text-text-muted">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data?.pages > 1 && (
          <div className="px-6 py-4 bg-surface border-t border-border flex items-center justify-between flex-shrink-0">
            <span className="text-sm text-text-muted">Página {page} de {data.pages} (Total: {data.total})</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-background border border-border rounded text-sm hover:bg-background/80 disabled:opacity-50">Anterior</button>
              <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page === data.pages} className="px-3 py-1 bg-background border border-border rounded text-sm hover:bg-background/80 disabled:opacity-50">Próxima</button>
            </div>
          </div>
        )}
      </div>

      {/* CRM DRAWER */}
      {activePayoutDrawer && (
        <PayoutDrawer payoutId={activePayoutDrawer._id} onClose={() => setActivePayoutDrawer(null)} />
      )}
    </div>
  );
}

// ==========================================
// DRAWER COMPONENT
// ==========================================

function PayoutDrawer({ payoutId, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const { data, isLoading } = useQuery({
    queryKey: ['payout-details', payoutId],
    queryFn: async () => {
      const res = await api.get(`/admin/payouts/${payoutId}`);
      return res.data;
    }
  });

  const approveMutation = useMutation({
    mutationFn: (id) => api.put(`/admin/payouts/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
      queryClient.invalidateQueries({ queryKey: ['payout-details', payoutId] });
      toast.success('Repasse aprovado — valor debitado do a receber do motorista, aguardando confirmação do Pix.');
    },
    onError: (err) => toast.error(err.response?.data?.message || err.message || 'Erro ao aprovar repasse')
  });

  const confirmPaidMutation = useMutation({
    mutationFn: (id) => api.put(`/admin/payouts/${id}/confirm-paid`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
      queryClient.invalidateQueries({ queryKey: ['payout-details', payoutId] });
      toast.success('Pagamento confirmado.');
    },
    onError: (err) => toast.error(err.response?.data?.message || err.message || 'Erro ao confirmar pagamento')
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => api.put(`/admin/payouts/${id}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
      queryClient.invalidateQueries({ queryKey: ['payout-details', payoutId] });
      toast.success('Solicitação rejeitada com sucesso.');
    },
    onError: (err) => toast.error(err.response?.data?.message || err.message || 'Erro ao rejeitar repasse')
  });

  if (isLoading) {
    return (
      <>
        <div className="fixed inset-0 bg-black/50 z-2000" onClick={onClose} />
        <div className="fixed inset-y-0 right-0 w-full md:w-[500px] lg:w-[600px] bg-surface z-2001 flex items-center justify-center">
          <p className="text-text-muted">Carregando detalhes...</p>
        </div>
      </>
    )
  }

  const payout = data?.payout;
  const logs = data?.logs || [];
  const captain = payout?.captainId;
  const wallet = data?.wallet;
  const captainFullName = `${captain?.fullname?.firstname || ''} ${captain?.fullname?.lastname || ''}`.trim();

  const handleApprove = async () => {
    if (await confirm({ message: 'Aprovar este repasse? O valor será debitado agora do a receber do motorista — o Pix em si precisa ser confirmado manualmente depois, pois não há gateway integrado.', tone: 'danger', confirmLabel: 'Aprovar e debitar' })) {
      approveMutation.mutate(payout._id);
    }
  };

  const handleConfirmPaid = async () => {
    if (await confirm({ message: 'Confirmar que o PIX foi efetivamente enviado ao motorista? Use apenas depois de verificar no extrato bancário real.', confirmLabel: 'Confirmar pagamento' })) {
      confirmPaidMutation.mutate(payout._id);
    }
  };

  const handleReject = async () => {
    const reason = await prompt({ message: 'Motivo da rejeição:', required: true });
    if (reason) {
      rejectMutation.mutate({ id: payout._id, reason });
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-2000 transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[500px] lg:w-[600px] bg-surface border-l border-border shadow-2xl z-2001 flex flex-col animate-slide-in">

        {/* Header */}
        <div className="shrink-0 border-b border-border bg-background p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              Solicitação #{payout._id.substring(18).toUpperCase()}
              <StatusBadge colorClass={statusColor(PAYOUT_STATUS_COLORS, payout.status)} label={statusLabel(PAYOUT_STATUS_LABELS, payout.status)} />
            </h2>
            <p className="text-sm text-text-muted mt-1">{formatDateTime(payout.createdAt)}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Action Bar */}
        {['requested', 'in_analysis', 'approved'].includes(payout.status) && (
          <div className="bg-surface border-b border-border p-4 flex gap-3">
            <button onClick={handleApprove} disabled={approveMutation.isPending || rejectMutation.isPending} className="flex-1 py-2 bg-primary text-background font-medium rounded hover:bg-primary/90 transition-colors flex justify-center items-center gap-2 disabled:opacity-50">
              <CheckCircle className="w-5 h-5" /> {approveMutation.isPending ? 'Processando...' : 'Aprovar e Debitar'}
            </button>
            <button onClick={handleReject} disabled={approveMutation.isPending || rejectMutation.isPending} className="flex-1 py-2 bg-danger/10 text-danger border border-danger/20 font-medium rounded hover:bg-danger/20 transition-colors flex justify-center items-center gap-2 disabled:opacity-50">
              <XCircle className="w-5 h-5" /> {rejectMutation.isPending ? 'Processando...' : 'Rejeitar'}
            </button>
          </div>
        )}
        {payout.status === 'processing' && (
          <div className="bg-surface border-b border-border p-4 space-y-3">
            <p className="text-xs text-text-muted">Valor já saiu do a receber do motorista. Confirme aqui só depois de verificar no extrato bancário real que o Pix foi enviado.</p>
            <button onClick={handleConfirmPaid} disabled={confirmPaidMutation.isPending} className="w-full py-2 bg-primary text-background font-medium rounded hover:bg-primary/90 transition-colors flex justify-center items-center gap-2 disabled:opacity-50">
              <CheckCircle className="w-5 h-5" /> {confirmPaidMutation.isPending ? 'Confirmando...' : 'Confirmar Pagamento Realizado'}
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-background/50">

          {/* Alertas */}
          {captain?.isBlocked && (
            <div className="p-3 bg-danger/10 border border-danger/20 rounded-lg flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-danger mt-0.5" />
              <div><p className="text-sm font-bold text-danger">Motorista Bloqueado</p><p className="text-xs text-danger/80">Você não pode aprovar pagamentos para motoristas bloqueados.</p></div>
            </div>
          )}

          {/* Conferência Financeira */}
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border bg-background/50 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-text">Conferência Financeira</h3>
              {captain?._id && (
                <Link
                  to={`/captains?search=${encodeURIComponent(captain.fullname?.firstname || captain.email || '')}`}
                  className="text-xs text-primary font-medium hover:underline"
                  title="Abre a ficha do motorista — o ajuste de créditos fica na aba Financeiro."
                >
                  Ajustar créditos deste motorista →
                </Link>
              )}
            </div>
            <div className="p-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-text-muted mb-1">A receber (repasse)</p>
                <p className="text-lg font-bold">{formatMoney(wallet?.pendingBalance)}</p>
                <p className="text-[11px] text-text-muted mt-1">O que a MoveCity deve a ele em corrida no cartão. Não são os créditos de comissão.</p>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-1">Valor Solicitado</p>
                <p className="text-lg font-bold text-primary">{formatMoney(payout.amount)}</p>
              </div>
              {['requested', 'in_analysis', 'approved'].includes(payout.status) && (
                <div className="col-span-2 pt-4 border-t border-border mt-2">
                  <p className="text-xs text-text-muted mb-1">A receber depois deste saque</p>
                  <p className={`text-lg font-bold ${((wallet?.pendingBalance || 0) - payout.amount) < 0 ? 'text-danger' : ''}`}>
                    {formatMoney((wallet?.pendingBalance || 0) - payout.amount)}
                  </p>
                  {((wallet?.pendingBalance || 0) - payout.amount) < 0 && (
                    <p className="text-xs text-danger mt-1">A receber insuficiente — a aprovação será recusada.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Detalhes de Pagamento & Gateway */}
          <div className="bg-surface rounded-xl border border-border p-4 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><Building className="w-4 h-4" /> Detalhes do Recebedor</h3>
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-sm text-text-muted">Nome</span><span className="text-sm font-medium">{captainFullName || '—'}</span></div>
              <div className="flex justify-between"><span className="text-sm text-text-muted">Chave Pix</span><span className="text-sm font-medium font-mono">{captain?.pixKey || 'Não cadastrada'}</span></div>
              <div className="flex justify-between"><span className="text-sm text-text-muted">Gateway</span><span className="text-sm font-medium uppercase">{payout.gateway || 'MANUAL'}</span></div>
              {payout.transactionId && <div className="flex justify-between"><span className="text-sm text-text-muted">ID Transação</span><span className="text-sm font-medium text-primary">{payout.transactionId}</span></div>}
            </div>
          </div>

          {/* Motivo de Rejeição */}
          {payout.reason && (
            <div className="bg-danger/5 border border-danger/20 rounded-xl p-4">
              <p className="text-xs font-bold uppercase text-danger mb-1">Motivo da Rejeição</p>
              <p className="text-sm text-text">{payout.reason}</p>
            </div>
          )}

          {/* Timeline (Auditoria) */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted mb-4">Timeline de Auditoria</h3>
            <div className="relative pl-4 space-y-4">
              <div className="absolute left-2.75 top-2 bottom-2 w-0.5 bg-border"></div>
              <div className="relative">
                <div className="absolute -left-3 top-1 w-3 h-3 rounded-full bg-border z-10"></div>
                <div className="pl-4">
                  <p className="text-sm font-medium text-text">Solicitação de Saque</p>
                  <p className="text-xs text-text-muted">{formatDateTime(payout.createdAt)}</p>
                </div>
              </div>
              {logs.map((log) => (
                <div key={log._id} className="relative">
                  <div className="absolute -left-3 top-1 w-3 h-3 rounded-full bg-primary z-10 border border-surface"></div>
                  <div className="pl-4">
                    <p className="text-sm font-medium text-primary capitalize">{log.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-text-muted">{formatDateTime(log.createdAt)}</p>
                    <p className="text-xs text-text mt-1 italic">{log.reason}</p>
                    <p className="text-[10px] text-text-muted mt-0.5">Por {log.adminName}</p>
                  </div>
                </div>
              ))}
              {payout.status === 'paid' && (
                <div className="relative">
                  <div className="absolute -left-3 top-1 w-3 h-3 rounded-full bg-primary z-10 border border-surface"></div>
                  <div className="pl-4">
                    <p className="text-sm font-medium text-primary">Repasse Finalizado</p>
                    <p className="text-xs text-text-muted">{formatDateTime(payout.paidAt)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Captain Financial History */}
          <CaptainFinancialHistory captainId={captain?._id} />

        </div>
      </div>
    </>
  )
}

// Auditoria de UX (2026-08-10): antes interlaçava rideModel/payoutModel direto
// ("Simulated financial history" no comentário original) — recarga, ajuste manual e
// bônus nunca apareciam. Agora consome transactionModel real (mesma fonte de
// getCaptainWallet), com tipo traduzido, saldo antes/depois e responsável.
function CaptainFinancialHistory({ captainId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['captain-financial-history', captainId],
    queryFn: async () => {
      if (!captainId) return null;
      const res = await api.get(`/admin/captains/${captainId}/financial-history`, { params: { limit: 15 } });
      return res.data;
    },
    enabled: !!captainId
  });

  if (isLoading) return <p className="text-xs text-text-muted">Carregando extrato...</p>;
  const transactions = data?.transactions;
  if (!transactions || transactions.length === 0) return null;

  return (
    <div className="pt-6 border-t border-border">
      <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted mb-4">Histórico Financeiro (Extrato Real)</h3>
      <div className="space-y-2">
        {transactions.map((tx) => {
          const view = describeCaptainLedgerTx(tx);
          return (
          <div key={tx._id} className="p-3 bg-surface border border-border rounded-lg">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{view.label}</p>
                <p className="text-xs text-text-muted truncate">{tx.description}</p>
                {view.amountHint && <p className="text-xs text-text-muted truncate">{view.amountHint}</p>}
                {tx.reason && <p className="text-xs text-text-muted italic truncate">Motivo: {tx.reason}</p>}
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold ${ledgerToneClass(view.tone)}`}>
                  {formatMoney(view.signedAmount, { showSign: view.tone !== 'info' })}
                </p>
                <p className="text-[10px] text-text-muted mt-0.5">{formatDateTime(tx.createdAt)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50 text-[11px] text-text-muted">
              <span>{view.balanceCaption}: {formatMoney(tx.balanceBefore)} → {formatMoney(tx.balanceAfter)}</span>
              {tx.adminId && <span>Responsável: {tx.adminId}</span>}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  )
}
