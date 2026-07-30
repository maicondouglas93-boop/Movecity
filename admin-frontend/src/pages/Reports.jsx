import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area 
} from 'recharts';
import { 
  TrendingUp, TrendingDown, DollarSign, Activity, Users, Car, 
  AlertTriangle, Calendar, Download, Printer, PieChart as PieIcon, 
  Clock, Map, ThumbsDown
} from 'lucide-react';

const COLORS = ['#00C853', '#2196F3', '#FFC107', '#F44336', '#9C27B0'];

export default function Reports() {
  const [period, setPeriod] = useState('30'); // days
  
  const dates = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - parseInt(period));
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }, [period]);

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

  const GrowthBadge = ({ value }) => {
    const isPositive = value >= 0;
    return (
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${isPositive ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
        {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {Math.abs(value).toFixed(1)}%
      </span>
    );
  };

  if (isLoadingDash) {
    return <div className="p-8 text-center text-text-muted">Analisando milhares de dados... 🚀</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      {/* Header & Filtros */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Business Intelligence (BI)</h1>
          <p className="text-text-muted mt-1">Visão executiva do crescimento e saúde financeira da plataforma.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="bg-surface border border-border p-1 rounded-lg flex items-center">
            <Calendar className="w-4 h-4 text-text-muted ml-2" />
            <select 
              value={period} 
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-transparent border-none text-sm font-medium text-text pl-2 pr-4 py-1 outline-none cursor-pointer"
            >
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="365">Último Ano</option>
            </select>
          </div>
          <button onClick={() => window.print()} className="p-2 bg-surface border border-border rounded-lg text-text-muted hover:text-primary transition-colors" title="Imprimir / Salvar PDF">
            <Printer className="w-5 h-5" />
          </button>
          <div className="relative group">
            <button className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg flex items-center gap-2 hover:bg-primary/90 transition-colors">
              <Download className="w-4 h-4" /> Exportar CSV
            </button>
            <div className="absolute right-0 top-full mt-2 w-48 bg-surface border border-border rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              <button onClick={() => handleExport('financial')} className="w-full text-left px-4 py-3 text-sm text-text hover:bg-background/50 first:rounded-t-xl">📊 Financeiro & Corridas</button>
              <button onClick={() => handleExport('passengers')} className="w-full text-left px-4 py-3 text-sm text-text hover:bg-background/50">👥 Ranking Passageiros</button>
              <button onClick={() => handleExport('captains')} className="w-full text-left px-4 py-3 text-sm text-text hover:bg-background/50 last:rounded-b-xl">🚗 Ranking Motoristas</button>
            </div>
          </div>
        </div>
      </div>

      {/* Alertas Operacionais (Mockados para Demo) */}
      {dashboard?.cancellations?.growth > 10 && (
        <div className="bg-danger/10 border border-danger/30 text-danger px-4 py-3 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          <span className="text-sm font-medium"><strong>Atenção:</strong> Os cancelamentos cresceram {dashboard.cancellations.growth.toFixed(1)}% no período comparativo. Considere criar uma campanha de retenção.</span>
        </div>
      )}

      {/* KPIs Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Receita */}
        <div className="bg-surface p-5 rounded-xl border border-border flex flex-col gap-3">
          <div className="flex justify-between items-start">
            <div className="p-2 bg-success/20 text-success rounded-lg"><DollarSign className="w-5 h-5" /></div>
            <GrowthBadge value={dashboard?.revenue?.growth} />
          </div>
          <div>
            <p className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">Receita Bruta</p>
            <p className="text-2xl font-black">R$ {(dashboard?.revenue?.current || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
        
        {/* Lucro */}
        <div className="bg-surface p-5 rounded-xl border border-border flex flex-col gap-3">
          <div className="flex justify-between items-start">
            <div className="p-2 bg-primary/20 text-primary rounded-lg"><Activity className="w-5 h-5" /></div>
            <GrowthBadge value={dashboard?.profit?.growth} />
          </div>
          <div>
            <p className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">Lucro (Repasses)</p>
            <p className="text-2xl font-black">R$ {(dashboard?.profit?.current || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>

        {/* Corridas */}
        <div className="bg-surface p-5 rounded-xl border border-border flex flex-col gap-3">
          <div className="flex justify-between items-start">
            <div className="p-2 bg-info/20 text-info rounded-lg"><Map className="w-5 h-5" /></div>
            <GrowthBadge value={dashboard?.rides?.growth} />
          </div>
          <div>
            <p className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">Corridas Finalizadas</p>
            <p className="text-2xl font-black">{(dashboard?.rides?.current || 0).toLocaleString('pt-BR')}</p>
          </div>
        </div>

        {/* Ticket Médio */}
        <div className="bg-surface p-5 rounded-xl border border-border flex flex-col gap-3">
          <div className="flex justify-between items-start">
            <div className="p-2 bg-warning/20 text-warning rounded-lg"><PieIcon className="w-5 h-5" /></div>
            <GrowthBadge value={dashboard?.avgTicket?.growth} />
          </div>
          <div>
            <p className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">Ticket Médio</p>
            <p className="text-2xl font-black">R$ {(dashboard?.avgTicket?.current || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
      </div>

      {/* Funil e SLA */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface p-5 rounded-xl border border-border flex items-center justify-between col-span-1">
           <div>
             <p className="text-xs text-text-muted font-bold uppercase tracking-wider flex items-center gap-1"><Clock className="w-3 h-3"/> SLA: Tempo de Aceite</p>
             <p className="text-xl font-black text-text mt-1">{Math.floor(dashboard?.sla?.avgWaitToAccept / 60)}m {(dashboard?.sla?.avgWaitToAccept % 60)}s</p>
           </div>
           <div className="text-right">
             <p className="text-xs text-text-muted font-bold uppercase tracking-wider flex items-center gap-1 justify-end"><Car className="w-3 h-3"/> Chegada</p>
             <p className="text-xl font-black text-text mt-1">{Math.floor(dashboard?.sla?.avgWaitToArrive / 60)}m</p>
           </div>
        </div>
        <div className="bg-surface p-5 rounded-xl border border-border flex items-center justify-between col-span-1 md:col-span-2">
           <div>
             <p className="text-xs text-text-muted font-bold uppercase tracking-wider">Descontos Aplicados</p>
             <p className="text-xl font-black text-danger mt-1">R$ {(dashboard?.revenue?.current * 0.05).toFixed(2)}</p>
           </div>
           <div>
             <p className="text-xs text-text-muted font-bold uppercase tracking-wider text-center">Taxa de Cancelamento</p>
             <p className="text-xl font-black text-warning mt-1 text-center">{((dashboard?.cancellations?.current / (dashboard?.rides?.current || 1)) * 100).toFixed(1)}%</p>
           </div>
           <div className="text-right">
             <p className="text-xs text-text-muted font-bold uppercase tracking-wider">Duração Média</p>
             <p className="text-xl font-black text-success mt-1">{Math.floor(dashboard?.sla?.avgRideTime / 60)} min</p>
           </div>
        </div>
      </div>

      {/* Gráficos Pesados (Lazy Load) */}
      {isLoadingCharts ? (
        <div className="h-64 flex items-center justify-center text-text-muted border border-border rounded-xl bg-surface/50">Carregando Gráficos Avançados...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Gráfico Principal (Linha/Area) */}
          <div className="lg:col-span-2 bg-surface border border-border rounded-xl p-6">
            <h2 className="text-sm font-bold uppercase tracking-wider text-text mb-6">Crescimento de Receita (R$)</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={charts?.revenueChart}>
                  <defs>
                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00C853" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#00C853" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis dataKey="_id" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `R$ ${val}`} />
                  <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', borderColor: '#333', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="revenue" stroke="#00C853" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gráficos de Pizza Secundários */}
          <div className="space-y-6">
            <div className="bg-surface border border-border rounded-xl p-6 h-[190px]">
              <h2 className="text-sm font-bold uppercase tracking-wider text-text mb-2">Formas de Pagamento</h2>
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
              <h2 className="text-sm font-bold uppercase tracking-wider text-text mb-2">Categorias</h2>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={charts?.pieCategories} dataKey="revenue" nameKey="_id" cx="50%" cy="50%" innerRadius={35} outerRadius={50} paddingAngle={5}>
                      {charts?.pieCategories?.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', borderColor: '#333' }} formatter={(val) => `R$ ${val}`} />
                    <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rankings (Lazy Load) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><Users className="w-4 h-4" /> Top 10 Passageiros</h2>
          </div>
          {isLoadingRankings ? (
            <p className="text-sm text-text-muted">Calculando ranking...</p>
          ) : (
            <div className="space-y-3">
              {rankings?.topPassengers?.map((p, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-background border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">{i + 1}</div>
                    <p className="text-sm font-medium text-text">{p.name || 'Usuário Removido'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-success">R$ {p.amount.toFixed(2)}</p>
                    <p className="text-[10px] text-text-muted">{p.rides} corridas</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><Car className="w-4 h-4" /> Top 10 Motoristas</h2>
          </div>
          {isLoadingRankings ? (
            <p className="text-sm text-text-muted">Calculando ranking...</p>
          ) : (
            <div className="space-y-3">
              {rankings?.topCaptains?.map((c, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-background border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-info/20 text-info flex items-center justify-center text-xs font-bold">{i + 1}</div>
                    <p className="text-sm font-medium text-text">{c.name || 'Motorista Removido'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-info">R$ {c.amount.toFixed(2)}</p>
                    <p className="text-[10px] text-text-muted">{c.rides} corridas</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
    </div>
  );
}
