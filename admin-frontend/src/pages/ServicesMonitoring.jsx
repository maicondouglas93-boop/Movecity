import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import {
  Activity, AlertTriangle, CheckCircle2, Database, Flame, Image as ImageIcon,
  Map, RefreshCw, Server, XCircle, Clock, DollarSign, ShieldAlert
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';

const ICONS = {
  map: Map,
  flame: Flame,
  database: Database,
  server: Server,
  image: ImageIcon,
  activity: Activity,
};

const statusTone = (status) => {
  if (status === 'healthy') return { text: 'text-primary', bg: 'bg-primary/15', label: 'Saudável', dot: 'bg-primary' };
  if (status === 'attention') return { text: 'text-amber-400', bg: 'bg-amber-400/15', label: 'Atenção', dot: 'bg-amber-400' };
  if (status === 'critical') return { text: 'text-danger', bg: 'bg-danger/15', label: 'Crítico', dot: 'bg-danger' };
  if (status === 'unavailable') return { text: 'text-text-muted', bg: 'bg-border/40', label: 'Indisponível', dot: 'bg-zinc-500' };
  return { text: 'text-text-muted', bg: 'bg-border/40', label: 'Desconhecido', dot: 'bg-zinc-500' };
};

const formatBytes = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

const formatUsd = (n) => (n == null ? '—' : `US$ ${Number(n).toFixed(2)}`);

const formatTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
};

function ProgressBar({ percent, tone = 'primary' }) {
  const p = Math.min(100, Math.max(0, percent ?? 0));
  const color = tone === 'danger' || p >= 90
    ? 'bg-danger'
    : p >= 70
      ? 'bg-amber-400'
      : 'bg-primary';
  return (
    <div className="h-2 w-full rounded-full bg-border/60 overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${p}%` }} />
    </div>
  );
}

function ServiceCard({ card, selected, onClick }) {
  const Icon = ICONS[card.icon] || Activity;
  const tone = statusTone(card.status);
  const pct = card.usagePercent;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-surface border rounded-xl p-5 transition-colors w-full ${
        selected ? 'border-primary' : 'border-border hover:border-primary/40'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tone.bg}`}>
          <Icon className={`w-5 h-5 ${tone.text}`} />
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${tone.bg} ${tone.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
          {tone.label}
        </span>
      </div>
      <h3 className="font-semibold text-text">{card.name}</h3>
      <p className="text-xs text-text-muted mt-0.5 truncate">{card.plan || '—'}</p>
      <div className="mt-4 space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-text-muted">Uso</span>
          <span className="font-medium">{pct != null ? `${pct}%` : '—'}</span>
        </div>
        <ProgressBar percent={pct ?? 0} />
        <p className="text-[11px] text-text-muted flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTime(card.lastUpdated)}
          {card.stale ? ' · cache' : ''}
        </p>
      </div>
    </button>
  );
}

function MapsDetail({ service }) {
  const skus = service?.details?.skus || [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{service?.details?.note}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted border-b border-border">
              <th className="py-2 pr-3 font-medium">API</th>
              <th className="py-2 pr-3 font-medium">Hoje</th>
              <th className="py-2 pr-3 font-medium">Ontem</th>
              <th className="py-2 pr-3 font-medium">Mês</th>
              <th className="py-2 pr-3 font-medium">Média/dia</th>
              <th className="py-2 pr-3 font-medium">Limite free</th>
              <th className="py-2 pr-3 font-medium">%</th>
              <th className="py-2 pr-3 font-medium">Custo mês</th>
              <th className="py-2 pr-3 font-medium">Erros</th>
              <th className="py-2 font-medium">Latência</th>
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <tr key={s.sku} className="border-b border-border/50">
                <td className="py-2.5 pr-3 font-medium">{s.label}</td>
                <td className="py-2.5 pr-3">{s.requestsToday}</td>
                <td className="py-2.5 pr-3">{s.requestsYesterday}</td>
                <td className="py-2.5 pr-3">{s.requestsMonth}</td>
                <td className="py-2.5 pr-3">{s.avgDaily}</td>
                <td className="py-2.5 pr-3">{s.freeLimit?.toLocaleString('pt-BR')}</td>
                <td className="py-2.5 pr-3">
                  <div className="min-w-[80px]">
                    <div className="flex justify-between text-[11px] mb-1">
                      <span>{s.usedPercent}%</span>
                    </div>
                    <ProgressBar percent={s.usedPercent} />
                  </div>
                </td>
                <td className="py-2.5 pr-3">{formatUsd(s.estimatedMonthCostUsd)}</td>
                <td className="py-2.5 pr-3 text-xs text-text-muted">
                  {s.errors} <span className="text-danger">403:{s.errors403}</span> 429:{s.errors429} 5xx:{s.errors500}
                </td>
                <td className="py-2.5">{s.latencyAvgMs != null ? `${s.latencyAvgMs} ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-muted">
        API Key: <span className="font-mono">{service?.summary?.apiKeyMasked || '—'}</span>
      </p>
    </div>
  );
}

function GenericDetail({ service }) {
  if (!service) return null;
  if (service.service === 'google_maps') return <MapsDetail service={service} />;

  const d = service.details || {};
  const rows = [];

  if (service.service === 'firebase') {
    rows.push(['Usuários Auth', d.authentication?.registeredUsers]);
    rows.push(['Fonte Auth', d.authentication?.source]);
    rows.push(['Logins hoje', d.authentication?.loginsToday]);
    rows.push(['FCM enviadas (mês)', d.cloudMessaging?.sent]);
    rows.push(['FCM entregues', d.cloudMessaging?.delivered]);
    rows.push(['FCM falhas', d.cloudMessaging?.failed]);
    rows.push(['Taxa de sucesso', d.cloudMessaging?.successRate != null ? `${d.cloudMessaging.successRate}%` : '—']);
    rows.push(['Projeto', service.summary?.projectId]);
  }
  if (service.service === 'mongodb') {
    rows.push(['Cluster', d.atlas?.name || service.summary?.clusterState]);
    rows.push(['Estado', d.atlas?.stateName || service.summary?.clusterState]);
    rows.push(['Armazenamento', formatBytes(d.metrics?.storageUsedBytes)]);
    rows.push(['Livre', formatBytes(d.metrics?.storageFreeBytes)]);
    rows.push(['Crescimento diário', formatBytes(d.metrics?.dailyGrowthBytes)]);
    rows.push(['Conexões', `${d.metrics?.connectionsOpen ?? '—'} / ${d.metrics?.connectionsMax ?? '—'}`]);
    rows.push(['Backup', d.atlas?.backupEnabled == null ? '—' : d.atlas.backupEnabled ? 'Ativo' : 'Inativo']);
    rows.push(['Versão MongoDB', d.atlas?.mongoDBVersion || '—']);
  }
  if (service.service === 'render') {
    rows.push(['Online', service.summary?.online ? 'Sim' : 'Não']);
    rows.push(['Uptime', `${Math.floor((service.summary?.uptimeSec || 0) / 3600)} h`]);
    rows.push(['Latência health', service.summary?.latencyMs != null ? `${service.summary.latencyMs} ms` : '—']);
    rows.push(['Memória RSS', `${d.local?.memory?.rssMb ?? '—'} MB`]);
    rows.push(['Heap', `${d.local?.memory?.heapUsedMb ?? '—'} / ${d.local?.memory?.heapTotalMb ?? '—'} MB`]);
    rows.push(['Versão', service.summary?.version]);
    rows.push(['Último deploy', d.render?.lastDeploy?.status || d.render?.lastDeploy?.commit || '—']);
  }
  if (service.service === 'imagekit') {
    rows.push(['Armazenamento', formatBytes(d.storageUsedBytes)]);
    rows.push(['Restante', formatBytes(d.storageRemainingBytes)]);
    rows.push(['Bandwidth', formatBytes(d.bandwidthUsedBytes)]);
    rows.push(['Bandwidth restante', formatBytes(d.bandwidthRemainingBytes)]);
    rows.push(['Transformações', d.transformations ?? '—']);
    rows.push(['Arquivos (amostra)', d.imagesCount ?? '—']);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {rows.map(([label, value]) => (
        <div key={label} className="bg-background/50 border border-border rounded-lg px-3 py-2.5">
          <p className="text-[11px] text-text-muted uppercase tracking-wide">{label}</p>
          <p className="text-sm font-medium mt-0.5 break-all">{value ?? '—'}</p>
        </div>
      ))}
      {d.note && <p className="sm:col-span-2 text-xs text-text-muted">{d.note}</p>}
    </div>
  );
}

export default function ServicesMonitoring() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('google_maps');
  const [historyRange, setHistoryRange] = useState('30');

  const { data, isLoading, isError, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['servicesMonitoring'],
    queryFn: async () => {
      const { data: res } = await api.get('/admin/monitoring/services');
      return res;
    },
    refetchInterval: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const { data: res } = await api.post('/admin/monitoring/refresh');
      return res;
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['servicesMonitoring'], res);
    },
  });

  const ackMutation = useMutation({
    mutationFn: async (id) => {
      await api.post(`/admin/monitoring/alerts/${id}/ack`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['servicesMonitoring'] }),
  });

  const selectedService = useMemo(
    () => data?.services?.find((s) => s.service === selected),
    [data, selected]
  );

  const historyData = useMemo(() => {
    if (!data?.history) return [];
    return historyRange === '7' ? data.history.last7Days : data.history.last30Days;
  }, [data, historyRange]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (isError) {
    return <div className="text-danger">Erro ao carregar monitoramento dos serviços.</div>;
  }

  const health = statusTone(data.health);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Monitoramento dos Serviços</h1>
          <p className="text-sm text-text-muted">
            Consumo, cotas, saúde e custos dos serviços externos — sem expor chaves no frontend.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border ${health.bg}`}>
            {data.health === 'healthy' ? <CheckCircle2 className={`w-4 h-4 ${health.text}`} />
              : data.health === 'critical' ? <XCircle className={`w-4 h-4 ${health.text}`} />
                : <AlertTriangle className={`w-4 h-4 ${health.text}`} />}
            <span className={`text-sm font-semibold ${health.text}`}>{data.healthLabel}</span>
          </div>
          <button
            type="button"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || isFetching}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-black font-semibold text-sm hover:bg-primary-hover disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshMutation.isPending || isFetching ? 'animate-spin' : ''}`} />
            Atualizar agora
          </button>
        </div>
      </div>

      {/* Consumo total + saúde */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-text-muted text-xs uppercase tracking-wide mb-2">
            <DollarSign className="w-4 h-4" /> Gasto estimado (mês)
          </div>
          <p className="text-2xl font-bold">{formatUsd(data.costs?.estimatedMonthUsd)}</p>
          <p className="text-xs text-text-muted mt-1">Hoje: {formatUsd(data.costs?.estimatedTodayUsd)}</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-text-muted text-xs uppercase tracking-wide mb-2">
            <ShieldAlert className="w-4 h-4" /> Economia do free tier
          </div>
          <p className="text-2xl font-bold text-primary">{formatUsd(data.costs?.freePlanSavingsUsd)}</p>
          <p className="text-xs text-text-muted mt-1">Créditos/limites gratuitos estimados</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-text-muted text-xs uppercase tracking-wide mb-2">
            <Activity className="w-4 h-4" /> Previsão fim do mês
          </div>
          <p className="text-2xl font-bold">{formatUsd(data.costs?.forecastMonthEndUsd)}</p>
          <p className="text-xs text-text-muted mt-1">Projeção linear pelo uso atual</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-text-muted text-xs uppercase tracking-wide mb-2">
            <Clock className="w-4 h-4" /> Última sincronização
          </div>
          <p className="text-lg font-bold">{formatTime(data.refreshedAt || dataUpdatedAt)}</p>
          <p className="text-xs text-text-muted mt-1">
            Status ~{data.intervals?.statusSeconds || 60}s · Consumo ~{Math.round((data.intervals?.usageSeconds || 300) / 60)} min
          </p>
        </div>
      </div>

      {/* Cards de serviços */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {(data.cards || []).map((card) => (
          <ServiceCard
            key={card.service}
            card={card}
            selected={selected === card.service}
            onClick={() => setSelected(card.service)}
          />
        ))}
      </div>

      {/* Detalhe + histórico */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">
              {data.cards?.find((c) => c.service === selected)?.name || 'Detalhes'}
            </h2>
            <span className="text-xs text-text-muted">
              Fonte: {selectedService?.source || '—'}
              {selectedService?.lastSuccessAt ? ` · OK ${formatTime(selectedService.lastSuccessAt)}` : ''}
            </span>
          </div>
          <GenericDetail service={selectedService} />
        </div>

        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Histórico Maps</h2>
            <select
              value={historyRange}
              onChange={(e) => setHistoryRange(e.target.value)}
              className="bg-background border border-border rounded-lg px-2 py-1 text-xs"
            >
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
            </select>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={historyData}>
                <defs>
                  <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="day" tick={{ fill: '#a1a1aa', fontSize: 10 }} tickFormatter={(v) => String(v).slice(5)} />
                <YAxis tick={{ fill: '#a1a1aa', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                  labelStyle={{ color: '#fafafa' }}
                />
                <Area type="monotone" dataKey="requests" stroke="#22c55e" fill="url(#reqFill)" name="Requisições" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="h-40 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="day" hide />
                <YAxis tick={{ fill: '#a1a1aa', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                />
                <Bar dataKey="errors" fill="#ef4444" name="Erros" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Alertas */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <h2 className="font-semibold text-lg mb-4">Central de alertas</h2>
        {(data.alerts || []).length === 0 ? (
          <p className="text-sm text-text-muted">Nenhum alerta ativo.</p>
        ) : (
          <ul className="space-y-3">
            {data.alerts.map((a) => {
              const t = statusTone(a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'attention' : 'healthy');
              const SeverityIcon = a.severity === 'critical' ? XCircle : a.severity === 'warning' ? AlertTriangle : CheckCircle2;
              return (
                <li key={a._id || a.fingerprint} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-border rounded-lg p-3 ${t.bg}`}>
                  <div className="flex items-start gap-2">
                    <SeverityIcon className={`w-4 h-4 shrink-0 mt-0.5 ${t.text}`} />
                    <div>
                      <p className={`text-sm font-semibold ${t.text}`}>{a.title}</p>
                      <p className="text-xs text-text-muted mt-0.5">{a.message}</p>
                      <p className="text-[11px] text-text-muted mt-1">{a.service} · {formatTime(a.updatedAt || a.createdAt)}</p>
                    </div>
                  </div>
                  {/* Auditoria de UX/produção (2026-08-10): ack não mostrava quem/quando
                      reconheceu — o backend agora grava acknowledgedBy/acknowledgedByName. */}
                  {!a.acknowledged ? (
                    <button
                      type="button"
                      onClick={() => ackMutation.mutate(a._id)}
                      className="text-xs font-medium px-3 py-2 rounded-lg border border-border hover:bg-background shrink-0"
                    >
                      Reconhecer
                    </button>
                  ) : (
                    <span className="text-[11px] text-text-muted shrink-0">
                      Reconhecido{a.acknowledgedByName ? ` por ${a.acknowledgedByName}` : ''}{a.acknowledgedAt ? ` · ${formatTime(a.acknowledgedAt)}` : ''}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-text-muted text-center">
        {data.costs?.note}
        {' '}Consultas às APIs oficiais são auditadas em <code className="text-text">/admin/monitoring/audit</code>.
      </p>
    </div>
  );
}
