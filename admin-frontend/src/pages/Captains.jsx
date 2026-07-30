import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useSocket } from '../contexts/SocketContext';
import { 
  Search, MapPin, MoreVertical, X, Clock, CreditCard, User, Car, Download, 
  CheckSquare, Square, Filter, ChevronRight, Activity, Map as MapIcon, 
  RotateCcw, ShieldAlert, CheckCircle, XCircle, Lock, Unlock, FileText, FileSearch, Star, 
  Battery, AlertTriangle, Briefcase, ChevronDown, Check, ArrowRight, History
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix leaflet icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function timeAgo(date) {
  if (!date) return "N/A";
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " anos atrás";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " meses atrás";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " dias atrás";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " horas atrás";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " min atrás";
  return "Agora mesmo";
}

const statusColors = {
  iniciado: 'bg-border text-text',
  documentos_enviados: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  em_analise: 'bg-warning/10 text-warning border-warning/20',
  aprovado: 'bg-primary/10 text-primary border-primary/20',
  reprovado: 'bg-danger/10 text-danger border-danger/20',
  suspenso: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  bloqueado: 'bg-red-500/10 text-red-500 border-red-500/20',
};

const statusNames = {
  iniciado: 'Iniciado',
  documentos_enviados: 'Docs Enviados',
  em_analise: 'Em Análise',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
  suspenso: 'Suspenso',
  bloqueado: 'Bloqueado',
};

export default function Captains() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: '', status: '', approvalStatus: '', vehicleType: '', isOnline: '', isBlocked: '' });
  const [searchInput, setSearchInput] = useState('');
  const [selectedCaptains, setSelectedCaptains] = useState([]);
  const [activeCaptainDrawer, setActiveCaptainDrawer] = useState(null);
  
  // Realtime drivers from socket
  const [liveDrivers, setLiveDrivers] = useState({});

  useEffect(() => {
    if (socket) {
      socket.on('admin-captain-location-updated', (data) => {
        setLiveDrivers(prev => ({ ...prev, [data.captainId]: data }));
      });
    }
    return () => {
      if (socket) socket.off('admin-captain-location-updated');
    };
  }, [socket]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['captains', page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ page, limit: 15, ...filters });
      const { data } = await api.get(`/admin/captains?${params.toString()}`);
      return data;
    },
    keepPreviousData: true
  });

  const handleSearch = (e) => {
    e.preventDefault();
    setFilters(prev => ({ ...prev, search: searchInput }));
    setPage(1);
  };

  const toggleSelectAll = () => {
    if (selectedCaptains.length === data?.captains?.length) {
      setSelectedCaptains([]);
    } else {
      setSelectedCaptains(data?.captains?.map(c => c._id) || []);
    }
  };

  const toggleSelect = (id) => {
    setSelectedCaptains(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

  const exportCSV = () => {
    if (!data?.captains) return;
    const items = selectedCaptains.length > 0 ? data.captains.filter(c => selectedCaptains.includes(c._id)) : data.captains;
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + "ID,Nome,Email,Placa,Status,Online,Avaliacao,Corridas\n"
      + items.map(c => `${c._id},${c.fullname?.firstname},${c.email},${c.vehicle?.plate},${c.approvalStatus},${c.isOnline ? 'Sim' : 'Nao'},${c.rating},${c.totalRides}`).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `frota_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] overflow-hidden bg-background">
      <div className="flex flex-col flex-1 w-full transition-all duration-300">
        
        {/* Header & Stats */}
        <div className="p-6 border-b border-border space-y-6 flex-shrink-0 bg-surface">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Frota / CRM Motoristas</h1>
              <p className="text-sm text-text-muted mt-1">Gestão, auditoria e suporte da frota de motoristas.</p>
            </div>
          </div>

          {/* Quick Stats Summary */}
          {data?.summary && (
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] flex flex-col cursor-pointer hover:border-primary/50" onClick={() => { setFilters(f => ({ ...f, isOnline: 'true' })); setPage(1); }}>
                <div className="flex items-center gap-2 mb-1 text-primary"><div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div><p className="text-xs font-medium">Online</p></div>
                <p className="text-2xl font-bold">{data.summary.online}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] flex flex-col">
                <div className="flex items-center gap-2 mb-1 text-purple-500"><Car className="w-3 h-3"/><p className="text-xs font-medium">Em Corrida</p></div>
                <p className="text-2xl font-bold">{data.summary.inRide}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] flex flex-col cursor-pointer hover:border-warning" onClick={() => { setFilters(f => ({ ...f, approvalStatus: 'em_analise' })); setPage(1); }}>
                <div className="flex items-center gap-2 mb-1 text-warning"><FileSearch className="w-3 h-3"/><p className="text-xs font-medium">Em Análise</p></div>
                <p className="text-2xl font-bold">{data.summary.inAnalysis}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] flex flex-col cursor-pointer hover:border-danger" onClick={() => { setFilters(f => ({ ...f, isBlocked: 'true' })); setPage(1); }}>
                <div className="flex items-center gap-2 mb-1 text-danger"><Lock className="w-3 h-3"/><p className="text-xs font-medium">Bloqueados</p></div>
                <p className="text-2xl font-bold">{data.summary.blocked}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] flex flex-col cursor-pointer hover:border-border" onClick={() => { setFilters(f => ({ ...f, isOnline: 'false' })); setPage(1); }}>
                <div className="flex items-center gap-2 mb-1 text-text-muted"><div className="w-2 h-2 rounded-full bg-border"></div><p className="text-xs font-medium">Offline</p></div>
                <p className="text-2xl font-bold">{data.summary.offline}</p>
              </div>
            </div>
          )}

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <form onSubmit={handleSearch} className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Buscar (Nome, Email, Placa)..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
            </form>
            
            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.isOnline} onChange={e => { setFilters(f => ({ ...f, isOnline: e.target.value })); setPage(1); }}>
              <option value="">Conexão (Todas)</option>
              <option value="true">Online</option>
              <option value="false">Offline</option>
            </select>
            
            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.approvalStatus} onChange={e => { setFilters(f => ({ ...f, approvalStatus: e.target.value })); setPage(1); }}>
              <option value="">Status Cadastro (Todos)</option>
              <option value="em_analise">Em Análise</option>
              <option value="aprovado">Aprovado</option>
              <option value="reprovado">Reprovado</option>
              <option value="bloqueado">Bloqueado</option>
            </select>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.vehicleType} onChange={e => { setFilters(f => ({ ...f, vehicleType: e.target.value })); setPage(1); }}>
              <option value="">Categoria (Todas)</option>
              <option value="moto">Moto</option>
              <option value="car">Carro</option>
            </select>
          </div>

          {/* Bulk Actions */}
          {selectedCaptains.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-lg animate-fade-in">
              <span className="text-sm font-medium text-primary">{selectedCaptains.length} selecionados</span>
              <div className="h-4 w-px bg-primary/20"></div>
              <button onClick={exportCSV} className="text-sm px-3 py-1 bg-background rounded border border-border flex items-center gap-2 hover:bg-background/80">
                <Download className="w-4 h-4" /> Exportar CSV
              </button>
            </div>
          )}
        </div>

        {/* List / Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-surface sticky top-0 border-b border-border text-text-muted z-10">
              <tr>
                <th className="px-4 py-3 w-10 text-center">
                  <button onClick={toggleSelectAll}>
                    {selectedCaptains.length > 0 && selectedCaptains.length === data?.captains?.length ? 
                      <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Motorista</th>
                <th className="px-4 py-3 font-medium">Veículo / Placa</th>
                <th className="px-4 py-3 font-medium">Avaliação / Corridas</th>
                <th className="px-4 py-3 font-medium">Carteira</th>
                <th className="px-4 py-3 font-medium">Status / Cadastro</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan="7" className="px-6 py-8 text-center text-text-muted">Carregando...</td></tr>
              ) : data?.captains?.length === 0 ? (
                <tr><td colSpan="7" className="px-6 py-8 text-center text-text-muted">Nenhum motorista encontrado.</td></tr>
              ) : (
                data?.captains?.map((captain) => {
                  const isSelected = selectedCaptains.includes(captain._id);
                  const isLive = liveDrivers[captain._id] || captain.isOnline;
                  const walletColor = captain.earnings < 0 ? 'text-danger' : captain.earnings > 0 ? 'text-primary' : 'text-text-muted';
                  return (
                    <tr key={captain._id} onClick={() => setActiveCaptainDrawer(captain)} className={`cursor-pointer hover:bg-surface/50 transition-colors ${isSelected ? 'bg-primary/5' : ''} ${captain.isBlocked ? 'opacity-70' : ''}`}>
                      <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => toggleSelect(captain._id)}>
                          {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-text-muted" />}
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-10 h-10 rounded-full bg-background border border-border flex items-center justify-center flex-shrink-0">
                              <User className="w-5 h-5 text-text-muted" />
                            </div>
                            {isLive && <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-500 border-2 border-surface rounded-full"></div>}
                            {!isLive && <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-border border-2 border-surface rounded-full"></div>}
                          </div>
                          <div>
                            <p className="font-medium text-text">{captain.fullname?.firstname} {captain.fullname?.lastname}</p>
                            <p className="text-xs text-text-muted">{captain.phone || captain.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex w-fit items-center gap-1 text-xs px-2 py-0.5 bg-background rounded border border-border capitalize">
                            <Car className="w-3 h-3 text-text-muted" /> {captain.vehicle?.vehicleType || 'N/A'}
                          </span>
                          <span className="text-xs text-text uppercase font-medium">{captain.vehicle?.plate || 'S/ PLACA'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1 mb-1">
                          <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                          <span className="font-medium">{captain.rating?.toFixed(1) || '5.0'}</span>
                        </div>
                        <p className="text-xs text-text-muted">{captain.totalRides || 0} corridas</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className={`font-medium ${walletColor}`}>R$ {captain.earnings?.toFixed(2) || '0.00'}</p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-2 items-start">
                           <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${statusColors[captain.approvalStatus] || 'bg-background'}`}>
                             {statusNames[captain.approvalStatus] || captain.approvalStatus}
                           </span>
                           {captain.isBlocked && (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border bg-danger/10 text-danger border-danger/20`}>
                                <Lock className="w-2.5 h-2.5 mr-1"/> Bloqueado
                              </span>
                           )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <CaptainActionMenu captain={captain} onAction={(action) => {
                          if (action === 'view') setActiveCaptainDrawer(captain);
                        }} />
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
      {activeCaptainDrawer && (
        <CaptainDrawer captain={activeCaptainDrawer} onClose={() => setActiveCaptainDrawer(null)} liveDrivers={liveDrivers} />
      )}
    </div>
  );
}

// ==========================================
// SUBCOMPONENTS
// ==========================================

function CaptainActionMenu({ captain, onAction }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handleClick = () => setOpen(false);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen(!open)} className="p-1.5 rounded-md hover:bg-background border border-transparent hover:border-border transition-colors text-text-muted">
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-surface border border-border rounded-lg shadow-xl z-50 py-1">
          <button onClick={() => onAction('view')} className="w-full text-left px-4 py-2 text-sm hover:bg-background flex items-center gap-2">
            <Search className="w-4 h-4" /> Ver Ficha CRM
          </button>
        </div>
      )}
    </div>
  );
}

function CaptainDrawer({ captain, onClose, liveDrivers }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('perfil');
  const isLive = liveDrivers[captain._id] || captain.isOnline;

  // Mutations for quick actions
  const approvalMutation = useMutation({
    mutationFn: (data) => api.put(`/admin/captains/${captain._id}/approval`, data),
    onSuccess: () => queryClient.invalidateQueries(['captains'])
  });

  const blockMutation = useMutation({
    mutationFn: (data) => api.put(`/admin/captains/${captain._id}/block`, data),
    onSuccess: () => queryClient.invalidateQueries(['captains'])
  });

  const handleBlock = () => {
    const reason = window.prompt(captain.isBlocked ? "Motivo do desbloqueio:" : "Motivo do bloqueio:");
    if (reason !== null) {
      blockMutation.mutate({ isBlocked: !captain.isBlocked, reason });
      onClose(); // Optional: close or just let it update behind
    }
  };

  const handleApprove = () => {
    if(window.confirm("Aprovar o cadastro deste motorista?")) {
      approvalMutation.mutate({ approvalStatus: 'aprovado', reason: 'Aprovado via painel CRM' });
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[2000] transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[600px] lg:w-[800px] bg-surface border-l border-border shadow-2xl z-[2001] flex flex-col animate-slide-in">
        
        {/* CRM Header */}
        <div className="flex-shrink-0 border-b border-border bg-surface">
           <div className="p-4 flex items-start justify-between bg-background/30">
              <div className="flex items-center gap-4">
                 <div className="relative">
                    <div className="w-16 h-16 rounded-full bg-background border border-border flex items-center justify-center">
                       <User className="w-8 h-8 text-text-muted" />
                    </div>
                    <div className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-surface ${isLive ? 'bg-green-500' : 'bg-border'}`}></div>
                 </div>
                 <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      {captain.fullname?.firstname} {captain.fullname?.lastname}
                      {captain.isBlocked && <span className="bg-danger/10 text-danger text-[10px] px-2 py-0.5 rounded uppercase font-bold tracking-wide">Bloqueado</span>}
                    </h2>
                    <p className="text-sm text-text-muted">{captain.email} • {captain.phone}</p>
                    <p className="text-xs text-text-muted mt-1 uppercase tracking-wide">ID: {captain._id}</p>
                 </div>
              </div>
              <div className="flex gap-2">
                 {/* Quick Actions */}
                 {captain.approvalStatus !== 'aprovado' && (
                   <button onClick={handleApprove} className="p-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors border border-primary/20" title="Aprovar">
                      <CheckCircle className="w-5 h-5" />
                   </button>
                 )}
                 <button onClick={handleBlock} className={`p-2 rounded-lg transition-colors border ${captain.isBlocked ? 'bg-background hover:bg-border text-text border-border' : 'bg-danger/10 hover:bg-danger/20 text-danger border-danger/20'}`} title={captain.isBlocked ? 'Desbloquear' : 'Bloquear'}>
                    {captain.isBlocked ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                 </button>
                 <button onClick={onClose} className="p-2 hover:bg-background rounded-full transition-colors ml-2"><X className="w-5 h-5" /></button>
              </div>
           </div>
           
           {/* Tabs */}
           <div className="flex overflow-x-auto px-4 hide-scrollbar border-t border-border/50">
              {['perfil', 'documentos', 'corridas', 'financeiro', 'auditoria'].map(tab => (
                 <button 
                   key={tab}
                   onClick={() => setActiveTab(tab)}
                   className={`px-4 py-3 text-sm font-medium capitalize border-b-2 whitespace-nowrap transition-colors ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}
                 >
                   {tab}
                 </button>
              ))}
           </div>
        </div>

        {/* CRM Content */}
        <div className="flex-1 overflow-y-auto bg-background/30 p-6">
           {activeTab === 'perfil' && <TabProfile captain={captain} liveDrivers={liveDrivers} />}
           {activeTab === 'documentos' && <TabDocuments captainId={captain._id} />}
           {activeTab === 'corridas' && <TabRides captainId={captain._id} />}
           {activeTab === 'financeiro' && <TabFinance captainId={captain._id} />}
           {activeTab === 'auditoria' && <TabAudit captainId={captain._id} />}
        </div>
      </div>
    </>
  )
}

function TabProfile({ captain, liveDrivers }) {
  const isLive = liveDrivers[captain._id] || captain.isOnline;
  const liveData = liveDrivers[captain._id]; // Might have ltd/lng from socket

  return (
    <div className="space-y-6">
      {/* Alertas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         {captain.earnings < 0 && (
           <div className="p-3 bg-danger/10 border border-danger/20 rounded-xl flex items-start gap-3">
             <AlertTriangle className="w-5 h-5 text-danger mt-0.5" />
             <div><p className="text-sm font-bold text-danger">Carteira Negativa</p><p className="text-xs text-danger/80">O motorista deve comissões à plataforma.</p></div>
           </div>
         )}
         {captain.rating < 4.5 && (
           <div className="p-3 bg-warning/10 border border-warning/20 rounded-xl flex items-start gap-3">
             <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
             <div><p className="text-sm font-bold text-warning">Avaliação Baixa ({captain.rating})</p><p className="text-xs text-warning/80">Acompanhe as últimas avaliações do passageiro.</p></div>
           </div>
         )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
         {/* Veículo */}
         <div className="bg-surface p-5 rounded-xl border border-border">
           <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted mb-4 flex items-center gap-2"><Car className="w-4 h-4"/> Veículo</h3>
           <div className="space-y-3">
              <div><p className="text-xs text-text-muted">Modelo</p><p className="font-medium text-sm capitalize">{captain.vehicle?.modelo || 'Não informado'}</p></div>
              <div><p className="text-xs text-text-muted">Placa</p><p className="font-bold text-lg uppercase bg-background border border-border px-3 py-1 rounded w-fit mt-1">{captain.vehicle?.plate || '---'}</p></div>
              <div><p className="text-xs text-text-muted">Cor / Ano</p><p className="font-medium text-sm capitalize">{captain.vehicle?.color} / {captain.vehicle?.ano}</p></div>
           </div>
         </div>

         {/* KPIs */}
         <div className="bg-surface p-5 rounded-xl border border-border">
           <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted mb-4 flex items-center gap-2"><Activity className="w-4 h-4"/> Desempenho</h3>
           <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-text-muted">Avaliação</p><p className="font-bold text-lg flex items-center gap-1"><Star className="w-4 h-4 text-yellow-500 fill-yellow-500"/> {captain.rating?.toFixed(1) || '5.0'}</p></div>
              <div><p className="text-xs text-text-muted">Total de Corridas</p><p className="font-bold text-lg">{captain.totalRides || 0}</p></div>
              <div><p className="text-xs text-text-muted">Taxa de Aceitação</p><p className="font-bold text-lg text-primary">{captain.acceptanceRate || 100}%</p></div>
              <div><p className="text-xs text-text-muted">Taxa de Cancelamento</p><p className="font-bold text-lg text-danger">{captain.cancellationRate || 0}%</p></div>
           </div>
         </div>
      </div>

      {/* Mapa (se online) */}
      {isLive && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden flex flex-col h-[300px]">
           <div className="p-3 border-b border-border bg-background/50 flex justify-between items-center">
              <h3 className="text-sm font-bold flex items-center gap-2"><MapIcon className="w-4 h-4"/> Localização em Tempo Real</h3>
              {liveData && <span className="text-xs bg-green-500/20 text-green-500 px-2 py-1 rounded">Atualizado agora</span>}
           </div>
           <div className="flex-1 bg-black/20">
             {liveData ? (
                <MapContainer center={[liveData.ltd, liveData.lng]} zoom={15} style={{ height: '100%', width: '100%', backgroundColor: '#18181b', zIndex: 10 }}>
                   <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                   <Marker position={[liveData.ltd, liveData.lng]}>
                      <Popup>Posição Atual do Motorista</Popup>
                   </Marker>
                </MapContainer>
             ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-text-muted">
                   <MapPin className="w-8 h-8 mb-2 opacity-50" />
                   <p className="text-sm">Aguardando ping do GPS...</p>
                </div>
             )}
           </div>
        </div>
      )}
    </div>
  )
}

function TabDocuments({ captainId }) {
  const queryClient = useQueryClient();
  const { data: docs, isLoading } = useQuery({
    queryKey: ['captain-documents', captainId],
    queryFn: async () => { const { data } = await api.get(`/admin/captains/${captainId}/documents`); return data; }
  });

  const verifyMutation = useMutation({
    mutationFn: ({ docType, verified, reason }) => api.put(`/admin/captains/${captainId}/documents/${docType}`, { verified, reason }),
    onSuccess: () => queryClient.invalidateQueries(['captain-documents', captainId])
  });

  if (isLoading) return <div className="p-6 text-center text-text-muted">Carregando documentos...</div>;
  if (!docs) return <div className="p-6 text-center text-text-muted">Nenhum documento encontrado.</div>;

  const handleVerify = (docType, isVerified) => {
    const reason = window.prompt(isVerified ? "Observação da aprovação (opcional):" : "Motivo da rejeição:");
    if (!isVerified && !reason) return; // reason is required for rejection
    verifyMutation.mutate({ docType, verified: isVerified, reason });
  }

  const DocumentRow = ({ title, docKey, docData }) => {
    if (!docData || !docData.url) return (
      <div className="flex items-center justify-between p-4 bg-surface rounded-xl border border-border">
         <div className="flex items-center gap-3"><FileText className="w-5 h-5 text-border" /><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-border">Não enviado</p></div></div>
      </div>
    );
    return (
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-surface rounded-xl border border-border gap-4">
         <div className="flex items-center gap-4">
            <a href={docData.url} target="_blank" rel="noreferrer" className="w-16 h-12 bg-background border border-border rounded overflow-hidden flex items-center justify-center hover:opacity-80 transition-opacity">
              <img src={docData.url} alt={title} className="w-full h-full object-cover" />
            </a>
            <div>
               <p className="text-sm font-medium">{title}</p>
               <span className={`text-xs inline-flex items-center gap-1 font-medium mt-1 ${docData.verified ? 'text-primary' : 'text-warning'}`}>
                 {docData.verified ? <><Check className="w-3 h-3"/> Aprovado</> : <><Clock className="w-3 h-3"/> Pendente Verificação</>}
               </span>
            </div>
         </div>
         <div className="flex gap-2 w-full md:w-auto">
            <button onClick={() => handleVerify(docKey, true)} className="flex-1 md:flex-none px-3 py-1.5 bg-primary/10 text-primary text-xs font-medium rounded hover:bg-primary/20 transition-colors border border-primary/20">Aprovar</button>
            <button onClick={() => handleVerify(docKey, false)} className="flex-1 md:flex-none px-3 py-1.5 bg-danger/10 text-danger text-xs font-medium rounded hover:bg-danger/20 transition-colors border border-danger/20">Rejeitar</button>
         </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted mb-4">Checklist Operacional</h3>
      <DocumentRow title="CNH Frente" docKey="cnhFront" docData={docs.cnhFront} />
      <DocumentRow title="CNH Verso" docKey="cnhBack" docData={docs.cnhBack} />
      <DocumentRow title="CRLV (Documento Veículo)" docKey="crlv" docData={docs.crlv} />
      <DocumentRow title="Foto do Veículo (Frente)" docKey="vehicleFront" docData={docs.vehicleFront} />
      <DocumentRow title="Selfie de Segurança" docKey="selfie" docData={docs.selfie} />
    </div>
  )
}

function TabRides({ captainId }) {
  const { data: rides, isLoading } = useQuery({
    queryKey: ['captain-rides', captainId],
    queryFn: async () => { const { data } = await api.get(`/admin/captains/${captainId}/recent-rides`); return data; }
  });

  if (isLoading) return <div className="p-6 text-center text-text-muted">Carregando histórico...</div>;
  if (!rides || rides.length === 0) return <div className="p-6 text-center text-text-muted bg-surface rounded-xl border border-border">Nenhuma corrida encontrada para este motorista.</div>;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted mb-4">Últimas 20 Corridas</h3>
      <div className="space-y-3">
         {rides.map(ride => (
           <div key={ride._id} className="p-4 bg-surface rounded-xl border border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                 <p className="text-sm font-medium flex items-center gap-2">
                   {new Date(ride.createdAt).toLocaleDateString()} às {new Date(ride.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                   <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${statusColors[ride.status] || 'bg-background'}`}>
                     {statusNames[ride.status] || ride.status}
                   </span>
                 </p>
                 <div className="flex items-center gap-2 mt-2 text-sm text-text-muted">
                    <span>{ride.pickup?.split(',')[0]}</span> <ArrowRight className="w-3 h-3"/> <span>{ride.destination?.split(',')[0]}</span>
                 </div>
              </div>
              <div className="text-left md:text-right">
                 <p className="font-bold text-primary">R$ {ride.fare?.toFixed(2) || '0.00'}</p>
                 <p className="text-xs text-text-muted">Passageiro: {ride.user?.fullname?.firstname || 'N/A'}</p>
              </div>
           </div>
         ))}
      </div>
    </div>
  )
}

function TabFinance({ captainId }) {
  const { data: wallet, isLoading } = useQuery({
    queryKey: ['captain-wallet', captainId],
    queryFn: async () => { const { data } = await api.get(`/admin/captains/${captainId}/wallet`); return data; }
  });

  if (isLoading) return <div className="p-6 text-center text-text-muted">Carregando dados financeiros...</div>;

  return (
    <div className="space-y-6">
       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-surface p-6 rounded-xl border border-border flex flex-col items-center justify-center text-center">
             <p className="text-sm font-bold uppercase tracking-wider text-text-muted mb-2">Saldo Atual</p>
             <p className={`text-4xl font-bold ${wallet?.balance < 0 ? 'text-danger' : 'text-primary'}`}>R$ {wallet?.balance?.toFixed(2) || '0.00'}</p>
             {wallet?.balance < 0 && <p className="text-xs text-danger mt-2 bg-danger/10 px-3 py-1 rounded">Devendo à Plataforma</p>}
          </div>
          <div className="bg-surface p-5 rounded-xl border border-border space-y-4">
             <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Valores Pendentes</span>
                <span className="font-medium text-warning">R$ {wallet?.pending?.toFixed(2) || '0.00'}</span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Comissões da Plataforma</span>
                <span className="font-medium text-text">R$ {wallet?.commissions?.toFixed(2) || '0.00'}</span>
             </div>
             <div className="pt-4 border-t border-border flex justify-between items-center">
                <span className="text-sm text-text-muted">Última Recarga</span>
                <span className="font-medium text-sm">{wallet?.lastRecharge ? new Date(wallet.lastRecharge).toLocaleDateString() : 'N/A'}</span>
             </div>
          </div>
       </div>
    </div>
  )
}

function TabAudit({ captainId }) {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['captain-timeline', captainId],
    queryFn: async () => { const { data } = await api.get(`/admin/captains/${captainId}/timeline`); return data; }
  });

  if (isLoading) return <div className="p-6 text-center text-text-muted">Carregando trilha de auditoria...</div>;
  if (!logs || logs.length === 0) return <div className="p-6 text-center text-text-muted bg-surface rounded-xl border border-border">Nenhum evento registrado.</div>;

  return (
    <div className="space-y-6">
       <div className="relative pl-6 space-y-6">
          <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border"></div>
          {logs.map((log) => (
             <div key={log._id} className="relative">
                <div className="absolute -left-[30px] top-1 w-4 h-4 rounded-full bg-surface border-2 border-primary z-10"></div>
                <div className="bg-surface p-4 rounded-xl border border-border">
                   <div className="flex justify-between items-start mb-2">
                      <p className="text-sm font-bold capitalize text-primary">{log.action.replace(/_/g, ' ')}</p>
                      <span className="text-xs text-text-muted">{new Date(log.createdAt).toLocaleString()}</span>
                   </div>
                   <p className="text-sm text-text mb-2">Motivo: <span className="italic">{log.reason}</span></p>
                   <p className="text-xs text-text-muted border-t border-border pt-2 mt-2">
                      Realizado por <span className="font-medium text-text">{log.adminName}</span> (IP: {log.ipAddress})
                   </p>
                </div>
             </div>
          ))}
       </div>
    </div>
  )
}
