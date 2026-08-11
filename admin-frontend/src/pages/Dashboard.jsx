import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../services/api';
import {
  Users, Route, DollarSign, AlertTriangle, Star, Clock, CheckCircle2, XCircle,
  Package, Circle, ArrowUpRight
} from 'lucide-react';
import { formatMoney, formatPercent } from '../utils/format';

const fetchDashboardStats = async (period) => {
  const { data } = await api.get(`/admin/dashboard?period=${period}`);
  return data;
};

const fetchHealthStats = async () => {
  const { data } = await api.get(`/admin/health`);
  return data;
};

const PERIOD_LABELS = { today: 'hoje', '7d': 'nos últimos 7 dias', '30d': 'nos últimos 30 dias' };

export default function Dashboard() {
  const [period, setPeriod] = useState('today');

  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['dashboardStats', period],
    queryFn: () => fetchDashboardStats(period),
    refetchInterval: 60000
  });

  const { data: health } = useQuery({
    queryKey: ['healthStats'],
    queryFn: fetchHealthStats,
    refetchInterval: 60000
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isError) {
    return <div className="text-danger">Erro ao carregar dados do dashboard.</div>;
  }

  const op = stats.operation || {};
  const periodLabel = PERIOD_LABELS[period] || period;

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-10">

      {/* HEADER & FILTERS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Centro de Operações</h1>
          <p className="text-sm text-text-muted">O que está acontecendo agora, como foi o desempenho, e o que precisa da sua atenção.</p>
        </div>

        <div className="flex items-center gap-4">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="bg-surface border border-border rounded-lg px-4 py-2 text-text focus:border-primary outline-none"
          >
            <option value="today">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
          </select>

          <div className="flex items-center gap-3 bg-surface border border-border px-4 py-2 rounded-lg text-sm">
            <span className="font-medium text-text-muted mr-2">Sistema:</span>
            <HealthIndicator label="API" status={health?.api} />
            <HealthIndicator label="DB" status={health?.mongodb} />
            <HealthIndicator label="Socket" status={health?.socket} />
            {health?.latency && <span className="text-xs text-text-muted ml-2">{health.latency}ms</span>}
          </div>
        </div>
      </div>

      {/* ===================== 1. OPERAÇÃO AGORA ===================== */}
      <section>
        <SectionHeader
          title="Operação agora"
          subtitle="Estado do sistema neste momento — não muda com o filtro de período acima."
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MiniStat
            icon={<Circle className="w-2.5 h-2.5 fill-primary text-primary" />}
            label="Motoristas online"
            value={op.captainsOnline}
            to="/captains?isOnline=true"
          />
          <MiniStat
            icon={<Circle className="w-2.5 h-2.5 fill-primary text-primary" />}
            label="Disponíveis"
            value={op.captainsAvailable}
            hint="Online e sem corrida ativa — podem receber uma nova agora."
            to="/captains?isOnline=true"
          />
          <MiniStat
            icon={<Circle className="w-2.5 h-2.5 fill-warning text-warning" />}
            label="Em corrida"
            value={op.captainsInRide}
            hint="Online, mas ocupados numa corrida ou encomenda."
          />
          <MiniStat
            icon={<Circle className="w-2.5 h-2.5 fill-text-muted text-text-muted" />}
            label="Offline"
            value={op.captainsOffline}
          />
          <MiniStat
            icon={<Route className="w-4 h-4 text-info" />}
            label="Corridas em andamento"
            value={op.ridesOngoing}
            to="/rides?status=ongoing"
          />
          <MiniStat
            icon={<Package className="w-4 h-4 text-info" />}
            label="Encomendas em andamento"
            value={op.parcelsOngoing}
            to="/rides?type=parcel&status=ongoing"
          />
          <MiniStat
            icon={<Users className="w-4 h-4 text-text-muted" />}
            label="Motoristas cadastrados"
            value={op.captainsTotal}
            hint="Total de contas de motorista, de qualquer status."
            to="/captains"
          />
        </div>
      </section>

      {/* ===================== 2. ATENÇÃO (logo após "agora", antes do desempenho — é o mais acionável) ===================== */}
      {stats.attention && stats.attention.length > 0 && (
        <section>
          <SectionHeader title="Precisa da sua atenção" subtitle="Situações que pedem uma ação administrativa." />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {stats.attention.map((item) => (
              <Link
                key={item.id}
                to={item.link || '#'}
                className={`flex items-start gap-3 p-4 rounded-xl border transition-colors group ${
                  item.severity === 'critical'
                    ? 'bg-danger/5 border-danger/30 hover:border-danger'
                    : 'bg-warning/5 border-warning/30 hover:border-warning'
                }`}
              >
                <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${item.severity === 'critical' ? 'text-danger' : 'text-warning'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text">{item.message}</p>
                  <span className="text-xs text-text-muted inline-flex items-center gap-1 mt-1 group-hover:text-text">
                    Resolver agora <ArrowUpRight className="w-3 h-3" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ===================== 3. HOJE / DESEMPENHO ===================== */}
      <section>
        <SectionHeader title={`Desempenho`} subtitle={`Resultado ${periodLabel}, comparado ao período anterior de mesma duração.`} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

          {/* RECEITA */}
          <div className="bg-surface p-6 rounded-xl border border-border">
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div className="text-right">
                <span className="text-sm text-text-muted block">Receita bruta</span>
                <span className="text-2xl font-bold text-text">{formatMoney(stats.revenue?.current?.gross)}</span>
              </div>
            </div>
            <ComparativeTrend current={stats.revenue?.current?.gross} prev={stats.revenue?.prev?.gross} money />
            <div className="mt-4 pt-4 border-t border-border/50 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-text-muted">Comissão da plataforma</span><span className="font-medium text-primary">{formatMoney(stats.revenue?.current?.commission)}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Repassado a motoristas</span><span className="font-medium text-text">{formatMoney(stats.revenue?.current?.payout)}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Ticket médio (corrida)</span><span className="font-medium text-text">{formatMoney(stats.revenue?.current?.avgTicket)}</span></div>
            </div>
          </div>

          {/* CORRIDAS */}
          <div className="bg-surface p-6 rounded-xl border border-border">
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 bg-info/10 rounded-lg flex items-center justify-center">
                <Route className="w-5 h-5 text-info" />
              </div>
              <div className="text-right">
                <span className="text-sm text-text-muted block">Corridas</span>
                <span className="text-2xl font-bold text-text">{stats.rides?.current?.total}</span>
              </div>
            </div>
            <ComparativeTrend current={stats.rides?.current?.total} prev={stats.rides?.prev?.total} />
            <div className="mt-4 pt-4 border-t border-border/50 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-text-muted">Concluídas</span><span className="font-medium text-primary">{stats.rides?.current?.finished}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Canceladas</span><span className="font-medium text-danger">{stats.rides?.current?.cancelled}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Taxa de cancelamento</span><span className="font-medium text-danger">{stats.quality?.current?.cancelRate?.toFixed(1)}%</span></div>
            </div>
          </div>

          {/* ENCOMENDAS + QUALIDADE */}
          <div className="bg-surface p-6 rounded-xl border border-border">
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                <Package className="w-5 h-5 text-purple-500" />
              </div>
              <div className="text-right">
                <span className="text-sm text-text-muted block">Encomendas</span>
                <span className="text-2xl font-bold text-text">{stats.parcels?.current?.total}</span>
              </div>
            </div>
            <ComparativeTrend current={stats.parcels?.current?.total} prev={stats.parcels?.prev?.total} />
            <div className="mt-4 pt-4 border-t border-border/50 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-text-muted">Concluídas</span><span className="font-medium text-primary">{stats.parcels?.current?.finished}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Canceladas</span><span className="font-medium text-danger">{stats.parcels?.current?.cancelled}</span></div>
              <div className="flex justify-between">
                <span className="text-text-muted">Avaliação média</span>
                <span className="font-medium text-text flex items-center gap-1">
                  {stats.quality?.current?.avgRating != null ? (<>{stats.quality.current.avgRating} <Star className="w-3 h-3 text-warning fill-warning" /></>) : 'Sem avaliações no período'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== RANKING ===================== */}
      <section>
        <SectionHeader title="Top motoristas" subtitle={`Por número de corridas concluídas ${periodLabel}.`} />
        <div className="bg-surface p-6 rounded-xl border border-border">
          <div className="space-y-2">
            {stats.ranking && stats.ranking.length > 0 ? (
              stats.ranking.map((driver, idx) => (
                <div key={driver._id} className="flex items-center justify-between p-3 rounded-lg hover:bg-background transition-colors border border-transparent hover:border-border/50 cursor-default">
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${idx === 0 ? 'bg-yellow-500/20 text-yellow-500' : idx === 1 ? 'bg-gray-300/20 text-gray-300' : idx === 2 ? 'bg-amber-700/20 text-amber-700' : 'bg-background text-text-muted'}`}>
                      {idx + 1}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-text">{driver.name}</p>
                      <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
                        <span className="flex items-center gap-0.5"><Star className="w-3 h-3 text-warning fill-warning" /> {driver.rating?.toFixed(1)}</span>
                        <span>• {driver.rides} corridas</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm text-primary">{formatMoney(driver.earnings)}</p>
                    <p className="text-xs text-text-muted mt-0.5">{driver.hoursOnline?.toFixed(1)}h online</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-muted text-center py-4">Nenhum dado de ranking para o período.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ============ Subcomponents ============

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-bold text-text uppercase tracking-wide">{title}</h2>
      {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
    </div>
  );
}

function MiniStat({ icon, label, value, hint, to }) {
  const content = (
    <div className={`bg-surface p-4 rounded-xl border border-border h-full flex flex-col gap-2 ${to ? 'hover:border-primary/50 transition-colors' : ''}`} title={hint}>
      <div className="flex items-center gap-2 text-text-muted">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="text-2xl font-bold text-text">{value ?? '—'}</span>
    </div>
  );
  return to ? <Link to={to} className="block">{content}</Link> : content;
}

// current/prev sempre em 0 não é "estável" — é ausência de atividade. Antes o cálculo
// caía no ramo `prev === 0 && current === 0` sem tratamento e mostrava "↑ 0.0%" verde
// (auditoria de UX, 2026-08-10).
function ComparativeTrend({ current, prev, money = false }) {
  if (current === undefined || prev === undefined) return null;

  if (prev === 0 && current === 0) {
    return <div className="text-xs text-text-muted">Sem atividade no período nem no anterior.</div>;
  }

  const diff = current - prev;
  const isPositive = diff >= 0;

  let percentage = 0;
  if (prev > 0) {
    percentage = (diff / prev) * 100;
  } else if (current > 0) {
    percentage = 100;
  }

  const formatVal = (val) => (money ? formatMoney(val) : val.toString());

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`font-semibold ${isPositive ? 'text-primary' : 'text-danger'}`}>
        {isPositive ? '↑' : '↓'} {formatPercent(percentage, { showSign: false })}
      </span>
      <span className="text-text-muted">
        vs {formatVal(prev)} (período anterior)
      </span>
    </div>
  );
}

function HealthIndicator({ label, status }) {
  let color = 'text-text-muted';
  let icon = <Clock className="w-3 h-3" />;

  if (status === true) {
    color = 'text-primary';
    icon = <CheckCircle2 className="w-3 h-3" />;
  } else if (status === false) {
    color = 'text-danger';
    icon = <XCircle className="w-3 h-3" />;
  }

  return (
    <div className={`flex items-center gap-1 ${color}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}
