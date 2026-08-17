import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import {
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, DollarSign, Activity, Users, Car,
  AlertTriangle, Calendar, Download, Printer, PieChart as PieIcon,
  Clock, Map, Percent
} from 'lucide-react';
import { formatMoney, formatDuration } from '../utils/format';

const COLORS = ['#00C853', '#2196F3', '#FFC107', '#F44336', '#9C27B0'];

// Auditoria de UX (2026-08-10): antes o seletor era "dias" fixos (7/30/90/365), sem
// corresponder ao vocabulário-alvo (Hoje/Ontem/Este mês/Personalizado). SLA e
// desconto eram total ou parcialmente inventados no front (comentário original:
// "SLAs simulados", cálculo de "5% fixo" pro desconto) — agora vêm reais do backend
// (report.service.js, 2026-08-10): sla.hasData indica se há amostra suficiente, e
// dashboard.discount.current soma o campo discountAmount real da corrida.
const PERIOD_PRESETS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'custom', label: 'Período personalizado' },
];

function getPeriodRange(preset, customStart, customEnd) {
  const now = new Date();
  if (preset === 'custom' && customStart && customEnd) {
    return { startDate: new Date(customStart).toISOString(), endDate: new Date(`${customEnd}T23:59:59.999`).toISOString() };
  }
  if (preset === 'today') {
    return { startDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(), endDate: now.toISOString() };
  }
  if (preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    const start = new Date(y.getFullYear(), y.getMonth(), y.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 0);
    end.setMilliseconds(-1);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }
  if (preset === 'month') {
    return { startDate: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), endDate: now.toISOString() };
  }
  const days = preset === '7d' ? 7 : 30;
  const start = new Date(now);
  start.setDate(now.getDate() - days);
  return { startDate: start.toISOString(), endDate: now.toISOString() };
}

export default function Reports() {
  const [period, setPeriod] = useState('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  const dates = useMemo(() => getPeriodRange(period, customStart, customEnd), [period, customStart, customEnd]);

  const { data: dashboard, isLoading: isLoadingDash } = useQuery({
    queryKey: ['reports', 'dashboard', dates],
    queryFn: async () => (await api.get('/admin/reports/dashboard', { params: dates })).data
  });

  const { data: charts, isLoading: isLoadingCharts } = useQuery({
    queryKey: ['reports', 'charts', dates],
    queryFn: async () => (await api.get('/admin/reports/charts', { params: dates })).data
  });

  const { data: rankings, isLoading: isLoadingRankings } = useQuery({
    queryKey: ['reports', 'rankings', dates],
    queryFn: async () => (await api.get('/admin/reports/rankings', { params: { ...dates, limit: 10 } })).data
  });

  const handleExport = async (type) => {
    setExportOpen(false);
    try {
      const response = await api.get(`/admin/reports/export/${type}`, {
        params: dates,
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `relatorio_${type}_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
    } catch (error) {
      console.error("Export error", error);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      {/* Header & Filtros */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-text-muted mt-1">Visão executiva do crescimento e saúde financeira da plataforma.</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="bg-surface border border-border p-1 rounded-lg flex items-center">
            <Calendar className="w-4 h-4 text-text-muted ml-2" />
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-transparent border-none text-sm font-medium text-text pl-2 pr-4 py-1 outline-none cursor-pointer"
            >
              {PERIOD_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {period === 'custom' && (
            <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-2 py-1">
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="bg-transparent text-sm outline-none" />
              <span className="text-text-muted text-xs">até</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="bg-transparent text-sm outline-none" />
            </div>
          )}
          <button onClick={() => window.print()} className="p-2 bg-surface border border-border rounded-lg text-text-muted hover:text-primary transition-colors" title="Imprimir / Salvar PDF">
            <Printer className="w-5 h-5" />
          </button>
          {/* Auditoria de UX (2026-08-10): menu de exportação só abria no hover, inacessível
              em toque/teclado. Agora controlado por clique, com fechamento ao clicar fora. */}
          <div className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              aria-expanded={exportOpen}
              aria-haspopup="true"
              className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg flex items-center gap-2 hover:bg-primary/90 transition-colors"
            >
              <Download className="w-4 h-4" /> Exportar CSV
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-52 bg-surface border border-border rounded-xl shadow-2xl z-50">
                  <button onClick={() => handleExport('financial')} className="w-full text-left px-4 py-3 text-sm text-text hover:bg-background/50 first:rounded-t-xl">Financeiro &amp; Corridas</button>
                  <button onClick={() => handleExport('passengers')} className="w-full text-left px-4 py-3 text-sm text-text hover:bg-background/50">Ranking Passageiros</button>
                  <button onClick={() => handleExport('captains')} className="w-full text-left px-4 py-3 text-sm text-text hover:bg-background/50 last:rounded-b-xl">Ranking Motoristas</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {isLoadingDash ? (
        <div className="p-8 text-center text-text-muted">Carregando relatório do período...</div>
      ) : (
        <>
          {/* Alerta operacional real: cancelamentos cresceram >10% vs. período anterior de mesma duração */}
          {Number.isFinite(dashboard?.cancellations?.growth) && dashboard.cancellations.growth > 10 && (
            <div className="bg-danger/10 border border-danger/30 text-danger px-4 py-3 rounded-lg flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium"><strong>Atenção:</strong> os cancelamentos cresceram {dashboard.cancellations.growth.toFixed(1)}% em relação ao período anterior de mesma duração.</span>
            </div>
          )}

          {/* ===== OPERAÇÃO ===== */}
          <SectionLabel>Operação</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<Map className="w-5 h-5" />} tone="info"
              label="Corridas concluídas" value={(dashboard?.rides?.current || 0).toLocaleString('pt-BR')}
              growth={dashboard?.rides?.growth}
            />
            <KpiCard
              icon={<Percent className="w-5 h-5" />} tone="warning"
              label="Taxa de cancelamento"
              value={Number.isFinite(dashboard?.cancellations?.rate) ? `${dashboard.cancellations.rate.toFixed(1)}%` : '—'}
              growth={Number.isFinite(dashboard?.cancellations?.rate) && Number.isFinite(dashboard?.cancellations?.ratePrev) ? dashboard.cancellations.rate - dashboard.cancellations.ratePrev : undefined}
              growthIsPoints
            />
            <SlaCard sla={dashboard?.sla} />
            <KpiCard
              icon={<PieIcon className="w-5 h-5" />} tone="warning"
              label="Ticket médio" value={formatMoney(dashboard?.avgTicket?.current)}
              growth={dashboard?.avgTicket?.growth}
            />
          </div>

          {/* ===== FINANCEIRO ===== */}
          <SectionLabel>Financeiro</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<DollarSign className="w-5 h-5" />} tone="primary"
              label="Receita bruta" value={formatMoney(dashboard?.revenue?.current)}
              growth={dashboard?.revenue?.growth}
            />
            <KpiCard
              icon={<Activity className="w-5 h-5" />} tone="primary"
              label="Comissão da plataforma" value={formatMoney(dashboard?.profit?.current)}
              growth={dashboard?.profit?.growth}
              hint="Valor retido pela plataforma sobre cada corrida — não é o repasse ao motorista, que é o inverso."
            />
            <div className="bg-surface p-5 rounded-xl border border-border flex flex-col gap-3">
              <div className="p-2 bg-danger/10 text-danger rounded-lg w-fit"><DollarSign className="w-5 h-5" /></div>
              <div>
                <p className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">Descontos aplicados</p>
                <p className="text-2xl font-black">{formatMoney(dashboard?.discount?.current)}</p>
                <p className="text-[11px] text-text-muted mt-1">Soma real de promoções aplicadas nas corridas do período.</p>
              </div>
            </div>
          </div>

          {/* Gráfico de receita */}
          {isLoadingCharts ? (
            <div className="h-64 flex items-center justify-center text-text-muted border border-border rounded-xl bg-surface/50">Carregando gráficos...</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-surface border border-border rounded-xl p-6">
                <h2 className="text-sm font-bold uppercase tracking-wider text-text mb-6">Receita por dia (R$)</h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={charts?.revenueChart}>
                      <defs>
                        <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00C853" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#00C853" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="_id" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `R$ ${val}`} />
                      <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', borderColor: '#333', borderRadius: '8px' }} formatter={(val) => formatMoney(val)} />
                      <Area type="monotone" dataKey="revenue" stroke="#00C853" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-surface border border-border rounded-xl p-6 h-[190px]">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-text mb-2">Formas de pagamento</h2>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={charts?.piePayments} dataKey="count" nameKey="_id" cx="50%" cy="50%" innerRadius={35} outerRadius={50} paddingAngle={5}>
                          {charts?.piePayments?.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', borderColor: '#333' }} />
                        <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '11px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-surface border border-border rounded-xl p-6 h-[190px]">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-text mb-2">Categorias de veículo</h2>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={charts?.pieCategories} dataKey="revenue" nameKey="_id" cx="50%" cy="50%" innerRadius={35} outerRadius={50} paddingAngle={5}>
                          {charts?.pieCategories?.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', borderColor: '#333' }} formatter={(val) => formatMoney(val)} />
                        <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '11px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== MOTORISTAS ===== */}
          <SectionLabel>Motoristas e clientes</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-surface border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><Users className="w-4 h-4" /> Top 10 passageiros (por gasto)</h2>
              </div>
              {isLoadingRankings ? (
                <p className="text-sm text-text-muted">Calculando ranking...</p>
              ) : rankings?.topPassengers?.length ? (
                <div className="space-y-3">
                  {rankings.topPassengers.map((p, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-background border border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">{i + 1}</div>
                        <p className="text-sm font-medium text-text">{p.name || 'Usuário removido'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-primary">{formatMoney(p.amount)}</p>
                        <p className="text-[10px] text-text-muted">{p.rides} corridas · gasto do passageiro</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted">Nenhum dado no período.</p>
              )}
            </div>

            <div className="bg-surface border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><Car className="w-4 h-4" /> Top 10 motoristas (ganho líquido)</h2>
              </div>
              {isLoadingRankings ? (
                <p className="text-sm text-text-muted">Calculando ranking...</p>
              ) : rankings?.topCaptains?.length ? (
                <div className="space-y-3">
                  {rankings.topCaptains.map((c, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-background border border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-info/20 text-info flex items-center justify-center text-xs font-bold">{i + 1}</div>
                        <p className="text-sm font-medium text-text">{c.name || 'Motorista removido'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-info">{formatMoney(c.amount)}</p>
                        <p className="text-[10px] text-text-muted">{c.rides} corridas · tarifa − comissão</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted">Nenhum dado no período.</p>
              )}
            </div>
          </div>
          <p className="text-xs text-text-muted italic">
            Relatório de clientes (ativos, retenção) ainda não existe — depende de um agregado novo no backend, fora do escopo desta correção.
          </p>
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return <h2 className="text-xs font-bold uppercase tracking-widest text-text-muted pt-2">{children}</h2>;
}

// Auditoria de UX (2026-08-10): GrowthBadge não tratava valor ausente — `value >= 0`
// com value=undefined é false, então caía sempre no ramo vermelho com "NaN%".
function GrowthBadge({ value, isPoints = false }) {
  if (!Number.isFinite(value)) {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 bg-border text-text-muted">
        <Minus className="w-3 h-3" /> sem dado anterior
      </span>
    );
  }
  const isPositive = value > 0;
  const isFlat = value === 0;
  const suffix = isPoints ? 'p.p.' : '%';
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${isFlat ? 'bg-border text-text-muted' : isPositive ? 'bg-primary/20 text-primary' : 'bg-danger/20 text-danger'}`}>
      {isFlat ? <Minus className="w-3 h-3" /> : isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}

const TONE_CLASSES = {
  primary: 'bg-primary/10 text-primary',
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

function KpiCard({ icon, tone, label, value, growth, growthIsPoints, hint }) {
  return (
    <div className="bg-surface p-5 rounded-xl border border-border flex flex-col gap-3" title={hint}>
      <div className="flex justify-between items-start">
        <div className={`p-2 rounded-lg ${TONE_CLASSES[tone] || TONE_CLASSES.info}`}>{icon}</div>
        <GrowthBadge value={growth} isPoints={growthIsPoints} />
      </div>
      <div>
        <p className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">{label}</p>
        <p className="text-2xl font-black">{value}</p>
      </div>
    </div>
  );
}

// SLA real (2026-08-10) — antes 3 constantes fixas que nunca mudavam com o período.
// hasData=false quando nenhuma corrida do período tem os timestamps novos
// (acceptedAt/arrivedAt/startedAt/finishedAt), o que inclui todo o histórico anterior
// a essa mudança — mostrado como "sem dados suficientes", nunca como zero.
function SlaCard({ sla }) {
  return (
    <div className="bg-surface p-5 rounded-xl border border-border flex flex-col gap-3">
      <div className="flex justify-between items-start">
        <div className="p-2 bg-info/10 text-info rounded-lg"><Clock className="w-5 h-5" /></div>
      </div>
      <div>
        <p className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">SLA de aceite</p>
        {sla?.hasData ? (
          <>
            <p className="text-2xl font-black">{formatDuration(sla.avgWaitToAccept)}</p>
            <p className="text-[11px] text-text-muted mt-1">Chegada: {formatDuration(sla.avgWaitToArrive)} · Duração: {formatDuration(sla.avgRideTime)} · {sla.sampleSize} corrida(s)</p>
          </>
        ) : (
          <>
            <p className="text-lg font-bold text-text-muted">Sem dados suficientes</p>
            <p className="text-[11px] text-text-muted mt-1">Nenhuma corrida do período tem o registro de horários necessário.</p>
          </>
        )}
      </div>
    </div>
  );
}
