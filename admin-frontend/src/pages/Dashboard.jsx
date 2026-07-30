import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { 
  Users, Car, Route, DollarSign, Activity, AlertTriangle, Medal, Star, Clock, Server, CheckCircle2, XCircle
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
} from 'recharts';

const fetchDashboardStats = async (period) => {
  const { data } = await api.get(`/admin/dashboard?period=${period}`);
  return data;
};

const fetchHealthStats = async () => {
  const { data } = await api.get(`/admin/health`);
  return data;
};

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

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      
      {/* HEADER & FILTERS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Centro de Operações</h1>
          <p className="text-sm text-text-muted">Métricas em tempo real e visão global do sistema.</p>
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

      {/* METRIC CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        {/* RECEITA */}
        <Link to="/finance" className="block bg-surface p-6 rounded-xl border border-border hover:border-primary/50 transition-colors group">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-primary" />
            </div>
            <div className="text-right">
              <span className="text-sm text-text-muted block">Receita Bruta</span>
              <span className="text-2xl font-bold text-text">R$ {stats.revenue?.current?.gross?.toFixed(2)}</span>
            </div>
          </div>
          <ComparativeTrend current={stats.revenue?.current?.gross} prev={stats.revenue?.prev?.gross} prefix="R$" />
          <div className="mt-4 pt-4 border-t border-border/50 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-text-muted">Comissão Plataforma</span><span className="font-medium text-primary">R$ {stats.revenue?.current?.commission?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Repassado Motoristas</span><span className="font-medium text-text">R$ {stats.revenue?.current?.payout?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Ticket Médio</span><span className="font-medium text-text">R$ {stats.revenue?.current?.avgTicket?.toFixed(2)}</span></div>
          </div>
        </Link>

        {/* MOTORISTAS */}
        <Link to="/captains" className="block bg-surface p-6 rounded-xl border border-border hover:border-primary/50 transition-colors group">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
              <Car className="w-5 h-5 text-blue-500" />
            </div>
            <div className="text-right">
              <span className="text-sm text-text-muted block">Motoristas Totais</span>
              <span className="text-2xl font-bold text-text">{stats.captains?.current?.total}</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border/50 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-text-muted">Online (Agora)</span><span className="font-medium text-text">{stats.captains?.current?.online}</span></div>
            <div className="flex justify-between"><span className="text-text-muted text-primary flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary"></span> Disponíveis</span><span className="font-medium text-text">{stats.captains?.current?.available}</span></div>
            <div className="flex justify-between"><span className="text-text-muted text-warning flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning"></span> Em Corrida</span><span className="font-medium text-text">{stats.captains?.current?.inRide}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Offline</span><span className="font-medium text-text">{stats.captains?.current?.offline}</span></div>
          </div>
        </Link>

        {/* CORRIDAS & QUALIDADE */}
        <Link to="/rides" className="block bg-surface p-6 rounded-xl border border-border hover:border-primary/50 transition-colors group">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
              <Route className="w-5 h-5 text-purple-500" />
            </div>
            <div className="text-right">
              <span className="text-sm text-text-muted block">Corridas ({period})</span>
              <span className="text-2xl font-bold text-text">{stats.rides?.current?.total}</span>
            </div>
          </div>
          <ComparativeTrend current={stats.rides?.current?.total} prev={stats.rides?.prev?.total} />
          <div className="mt-4 pt-4 border-t border-border/50 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-text-muted">Concluídas</span><span className="font-medium text-primary">{stats.rides?.current?.finished}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Taxa de Cancelamento</span><span className="font-medium text-danger">{stats.quality?.current?.cancelRate?.toFixed(1)}%</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Avaliação Média</span><span className="font-medium text-text flex items-center gap-1">{stats.quality?.current?.avgRating} <Star className="w-3 h-3 text-warning fill-warning" /></span></div>
            <div className="flex justify-between"><span className="text-text-muted">Tempo Busca Motorista</span><span className="font-medium text-text">{stats.quality?.current?.avgSearchTimeSeconds ? `${stats.quality.current.avgSearchTimeSeconds}s` : 'Não disp.'}</span></div>
          </div>
        </Link>

        {/* ALERTAS DO SISTEMA */}
        <div className="bg-surface p-6 rounded-xl border border-border flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <h2 className="text-lg font-semibold">Alertas do Sistema</h2>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3">
            {stats.alerts && stats.alerts.length > 0 ? (
              stats.alerts.map((alert, idx) => (
                <div key={idx} className="text-sm p-3 bg-background rounded-lg border border-border/50">
                  {alert}
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-text-muted space-y-2">
                <CheckCircle2 className="w-8 h-8 text-primary/50" />
                <span className="text-sm">Nenhum alerta crítico.</span>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* RANKING & CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* RANKING */}
        <div className="lg:col-span-1 bg-surface p-6 rounded-xl border border-border">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Medal className="w-5 h-5 text-primary" />
              Top Motoristas
            </h2>
            <span className="text-xs text-text-muted px-2 py-1 bg-background rounded-md">{period}</span>
          </div>
          
          <div className="space-y-4">
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
                    <p className="font-bold text-sm text-primary">R$ {driver.earnings?.toFixed(2)}</p>
                    <p className="text-xs text-text-muted mt-0.5">{driver.hoursOnline?.toFixed(1)}h online</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-muted text-center py-4">Nenhum dado de ranking para o período.</p>
            )}
          </div>
        </div>

        {/* CHARTS / PLACEHOLDER PARA EVOLUÇÃO */}
        <div className="lg:col-span-2 bg-surface p-6 rounded-xl border border-border flex flex-col items-center justify-center text-center">
          <Activity className="w-12 h-12 text-primary/20 mb-4" />
          <h2 className="text-lg font-semibold mb-2">Painel de Gráficos</h2>
          <p className="text-text-muted text-sm max-w-md">
            Esta área modular está pronta para receber gráficos detalhados de evolução de corridas e receita nos próximos ciclos de atualização, consumindo o nó <code>charts</code> da API.
          </p>
        </div>

      </div>
    </div>
  );
}

// Subcomponents

function ComparativeTrend({ current, prev, prefix = '' }) {
  if (current === undefined || prev === undefined) return null;
  
  const diff = current - prev;
  const isPositive = diff >= 0;
  
  let percentage = 0;
  if (prev > 0) {
    percentage = (diff / prev) * 100;
  } else if (current > 0) {
    percentage = 100;
  }

  const formatVal = (val) => {
    return prefix ? `${prefix} ${val.toFixed(2)}` : val.toString();
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`font-semibold ${isPositive ? 'text-primary' : 'text-danger'}`}>
        {isPositive ? '↑' : '↓'} {Math.abs(percentage).toFixed(1)}%
      </span>
      <span className="text-text-muted">
        vs {formatVal(prev)} (período ant.)
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
