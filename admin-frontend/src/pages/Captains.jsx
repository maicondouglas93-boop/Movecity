import React, { useState, useEffect, memo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import api from '../services/api';
import { useSocket } from '../contexts/SocketContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePrompt } from '../contexts/PromptContext';
import { buildCsv, downloadCsv } from '../utils/csv';
import { formatMoney, formatDate } from '../utils/format';
import { describeCaptainLedgerTx, ledgerToneClass } from '../utils/captainLedgerDisplay';
import {
  CAPTAIN_APPROVAL_LABELS, CAPTAIN_APPROVAL_COLORS,
  RIDE_STATUS_LABELS, RIDE_STATUS_COLORS,
  statusLabel, statusColor,
} from '../utils/statusDictionary';
import StatusBadge from '../components/StatusBadge';
import {
  Search, MapPin, MoreVertical, X, Clock, User, Car, Download,
  CheckSquare, Square, Activity, Map as MapIcon,
  CheckCircle, Lock, Unlock, FileText, FileSearch, Star,
  AlertTriangle, Check, ArrowRight, History, Pencil, KeyRound, Upload
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

// Auditoria de UX (2026-08-10): statusColors/statusNames locais (só approvalStatus)
// foram promovidos pro dicionário compartilhado (utils/statusDictionary.js) — estavam
// sendo reaproveitados por engano em status de CORRIDA (TabRides), que tem um enum
// totalmente diferente e sempre caía no fallback cinza com o texto cru em inglês.

// "Disponível"/"Em corrida"/"Offline" — status OPERACIONAL, não confundir com
// approvalStatus (status DA CONTA, acima). Ver captain.operationalStatus (calculado no
// backend, getCaptains).
const OPERATIONAL_STATUS_LABELS = {
  available: 'Disponível',
  in_ride: 'Em corrida',
  offline: 'Offline',
};
const OPERATIONAL_STATUS_COLORS = {
  available: 'bg-primary/10 text-primary border-primary/20',
  in_ride: 'bg-warning/10 text-warning border-warning/20',
  offline: 'bg-background text-text-muted border-border',
};

const VEHICLE_AUTHORIZATION_OPTIONS = [
  { value: 'car', label: '🚗 Carro' },
  { value: 'motorcycle', label: '🏍️ Moto' },
  { value: 'car_motorcycle', label: '🚗🏍️ Carro e Moto' },
];
const VEHICLE_AUTHORIZATION_LABELS = Object.fromEntries(
  VEHICLE_AUTHORIZATION_OPTIONS.map((option) => [option.value, option.label])
);
const effectiveVehicleAuthorization = (captain) => captain?.vehicleAuthorization
  || (['moto', 'motorcycle'].includes(captain?.vehicle?.vehicleType) ? 'motorcycle' : null)
  || (captain?.vehicle?.vehicleType === 'car' ? 'car' : null);
const vehicleAuthorizationLabel = (captain) =>
  VEHICLE_AUTHORIZATION_LABELS[effectiveVehicleAuthorization(captain)] || 'Definir no ADM';

export default function Captains() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  // Estado inicial lido da URL (auditoria de UX, 2026-08-10) — o Dashboard linka pra
  // cá com filtro pronto (ex.: /captains?approvalStatus=em_analise); sem isso o link
  // abria a tela sem filtrar nada.
  const [searchParams] = useSearchParams();

  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    search: searchParams.get('search') || '',
    status: '',
    approvalStatus: searchParams.get('approvalStatus') || '',
    vehicleType: '',
    vehicleAuthorization: '',
    isOnline: searchParams.get('isOnline') || '',
    isBlocked: searchParams.get('isBlocked') || '',
    operationalStatus: searchParams.get('operationalStatus') || '',
  });
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
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
    placeholderData: keepPreviousData
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

    const csvUri = buildCsv(
      ['ID', 'Nome', 'Sobrenome', 'Email', 'Telefone', 'Placa', 'Tipo autorizado', 'Status da Conta', 'Disponibilidade', 'Avaliacao', 'Corridas'],
      items.map(c => [
        c._id, c.fullname?.firstname, c.fullname?.lastname, c.email, c.phone, c.vehicle?.plate,
        vehicleAuthorizationLabel(c),
        statusLabel(CAPTAIN_APPROVAL_LABELS, c.approvalStatus),
        OPERATIONAL_STATUS_LABELS[c.operationalStatus] || c.operationalStatus,
        c.rating, c.totalRides,
      ])
    );
    downloadCsv(csvUri, `frota_${new Date().getTime()}.csv`);
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
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] flex flex-col cursor-pointer hover:border-primary/50" onClick={() => { setFilters(f => ({ ...f, isOnline: 'true', operationalStatus: '' })); setPage(1); }} title="Motoristas com o app conectado agora (disponíveis + em corrida)">
                <div className="flex items-center gap-2 mb-1 text-primary"><div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div><p className="text-xs font-medium">Online</p></div>
                <p className="text-2xl font-bold">{data.summary.online}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] flex flex-col cursor-pointer hover:border-warning" onClick={() => { setFilters(f => ({ ...f, isOnline: '', operationalStatus: 'in_ride' })); setPage(1); }} title="Online, mas ocupados numa corrida ou encomenda agora">
                <div className="flex items-center gap-2 mb-1 text-warning"><Car className="w-3 h-3"/><p className="text-xs font-medium">Em Corrida</p></div>
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
              value={filters.isOnline} onChange={e => { setFilters(f => ({ ...f, isOnline: e.target.value, operationalStatus: '' })); setPage(1); }}
              title="Se o app do motorista está conectado, independente de estar livre ou ocupado">
              <option value="">Conexão (Todas)</option>
              <option value="true">Online</option>
              <option value="false">Offline</option>
            </select>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.operationalStatus} onChange={e => { setFilters(f => ({ ...f, operationalStatus: e.target.value, isOnline: '' })); setPage(1); }}
              title="Se o motorista pode receber uma corrida agora">
              <option value="">Disponibilidade (Todas)</option>
              <option value="available">Disponível</option>
              <option value="in_ride">Em corrida</option>
              <option value="offline">Offline</option>
            </select>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.approvalStatus} onChange={e => { setFilters(f => ({ ...f, approvalStatus: e.target.value })); setPage(1); }}>
              <option value="">Status Cadastro (Todos)</option>
              <option value="iniciado">Iniciado</option>
              <option value="documentos_enviados">Docs Enviados</option>
              <option value="em_analise">Em Análise</option>
              <option value="aprovado">Aprovado</option>
              <option value="reprovado">Reprovado</option>
              <option value="expirado">Prazo Expirado</option>
              <option value="bloqueado">Bloqueado</option>
            </select>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.vehicleType} onChange={e => { setFilters(f => ({ ...f, vehicleType: e.target.value })); setPage(1); }}>
              <option value="">Categoria (Todas)</option>
              <option value="moto">Moto</option>
              <option value="car">Carro</option>
            </select>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.vehicleAuthorization} onChange={e => { setFilters(f => ({ ...f, vehicleAuthorization: e.target.value })); setPage(1); }}>
              <option value="">Autorização (Todas)</option>
              {VEHICLE_AUTHORIZATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
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
                <th className="px-4 py-3 font-medium">Créditos / a receber</th>
                <th className="px-4 py-3 font-medium">Conexão</th>
                <th className="px-4 py-3 font-medium">Status da conta</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan="8" className="px-6 py-8 text-center text-text-muted">Carregando...</td></tr>
              ) : data?.captains?.length === 0 ? (
                <tr><td colSpan="8" className="px-6 py-8 text-center text-text-muted">Nenhum motorista encontrado.</td></tr>
              ) : (
                data?.captains?.map((captain) => (
                  <CaptainRow
                    key={captain._id}
                    captain={captain}
                    isSelected={selectedCaptains.includes(captain._id)}
                    isLive={!!(liveDrivers[captain._id] || captain.isOnline)}
                    onToggleSelect={toggleSelect}
                    onOpenDrawer={setActiveCaptainDrawer}
                  />
                ))
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
        <CaptainDrawer
          captain={activeCaptainDrawer}
          onClose={() => setActiveCaptainDrawer(null)}
          liveDrivers={liveDrivers}
          onCaptainUpdated={setActiveCaptainDrawer}
        />
      )}
    </div>
  );
}

// ==========================================
// SUBCOMPONENTS
// ==========================================

// Bloco J (2026-08-02, achado R33): antes, cada ping de GPS (admin-captain-location-
// updated) recriava liveDrivers e re-renderizava a tabela inteira — com 50 motoristas
// online enviando posição a cada poucos segundos, isso é ~10 re-renders completos de
// 15 linhas por segundo. React.memo faz React pular a linha inteira quando nenhuma das
// props mudou; isLive é passado como boolean já calculado (não o objeto liveDrivers
// inteiro), então a maioria dos pings — que não mudam se um motorista está online ou
// não, só a posição, que esta linha nem exibe — não recalcula nada aqui.
const CaptainRow = memo(function CaptainRow({ captain, isSelected, isLive, onToggleSelect, onOpenDrawer }) {
  const credits = captain.creditBalance ?? 0;
  const pending = captain.pendingBalance ?? 0;
  const creditColor = credits < 0 ? 'text-danger' : 'text-text';
  // operationalStatus vem calculado do backend (getCaptains) — online+fresco+livre =
  // disponível; online+fresco+ocupado = em corrida; senão offline. Não confundir com
  // approvalStatus (status DA CONTA), mostrado na outra coluna.
  const opStatus = captain.operationalStatus || (isLive ? 'available' : 'offline');
  return (
    <tr onClick={() => onOpenDrawer(captain)} className={`cursor-pointer hover:bg-surface/50 transition-colors ${isSelected ? 'bg-primary/5' : ''} ${captain.isBlocked ? 'opacity-70' : ''}`}>
      <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onToggleSelect(captain._id)}>
          {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-text-muted" />}
        </button>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-background border border-border flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-text-muted" />
            </div>
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
          <span className="text-xs text-text-muted">Autorizado: {vehicleAuthorizationLabel(captain)}</span>
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
        <p className={`font-medium ${creditColor}`}>{formatMoney(credits)}</p>
        <p className="text-xs text-text-muted">A receber {formatMoney(pending)}</p>
      </td>
      <td className="px-4 py-4" title={OPERATIONAL_STATUS_LABELS[opStatus]}>
        <StatusBadge colorClass={OPERATIONAL_STATUS_COLORS[opStatus]} label={OPERATIONAL_STATUS_LABELS[opStatus]} />
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-col gap-2 items-start">
           <StatusBadge colorClass={statusColor(CAPTAIN_APPROVAL_COLORS, captain.approvalStatus)} label={statusLabel(CAPTAIN_APPROVAL_LABELS, captain.approvalStatus)} />
           {captain.isBlocked && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border bg-danger/10 text-danger border-danger/20">
                <Lock className="w-2.5 h-2.5 mr-1"/> Bloqueado
              </span>
           )}
        </div>
      </td>
      <td className="px-4 py-4 text-right" onClick={(e) => e.stopPropagation()}>
        <CaptainActionMenu captain={captain} onAction={(action) => {
          if (action === 'view') onOpenDrawer(captain);
        }} />
      </td>
    </tr>
  );
});

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

function CaptainDrawer({ captain, onClose, liveDrivers, onCaptainUpdated }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [activeTab, setActiveTab] = useState('perfil');
  const isLive = liveDrivers[captain._id] || captain.isOnline;

  // Mutations for quick actions
  const approvalMutation = useMutation({
    mutationFn: (data) => api.put(`/admin/captains/${captain._id}/approval`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captains'] });
      toast.success('Cadastro aprovado com sucesso.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao aprovar cadastro')
  });

  const blockMutation = useMutation({
    mutationFn: (data) => api.put(`/admin/captains/${captain._id}/block`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['captains'] });
      toast.success(variables.isBlocked ? 'Motorista bloqueado.' : 'Motorista desbloqueado.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao alterar bloqueio do motorista')
  });

  const handleBlock = async () => {
    const reason = await prompt({
      title: captain.isBlocked ? 'Desbloquear motorista' : 'Bloquear motorista',
      message: captain.isBlocked ? 'Motivo do desbloqueio:' : 'Motivo do bloqueio:',
      required: true
    });
    if (reason !== null) {
      blockMutation.mutate({ isBlocked: !captain.isBlocked, reason });
      onClose(); // Optional: close or just let it update behind
    }
  };

  const handleApprove = async () => {
    if (await confirm('Aprovar o cadastro deste motorista?')) {
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
           {activeTab === 'perfil' && (
             <TabProfile
               captain={captain}
               liveDrivers={liveDrivers}
               onCaptainUpdated={onCaptainUpdated}
             />
           )}
           {activeTab === 'documentos' && <TabDocuments captainId={captain._id} />}
           {activeTab === 'corridas' && <TabRides captainId={captain._id} />}
           {activeTab === 'financeiro' && <TabFinance captainId={captain._id} captainName={`${captain.fullname?.firstname || ''} ${captain.fullname?.lastname || ''}`.trim()} />}
           {activeTab === 'auditoria' && <TabAudit captainId={captain._id} />}
        </div>
      </div>
    </>
  )
}

function TabProfile({ captain, liveDrivers, onCaptainUpdated }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editVehicleOpen, setEditVehicleOpen] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const isLive = liveDrivers[captain._id] || captain.isOnline;
  const liveData = liveDrivers[captain._id]; // Might have ltd/lng from socket

  const vehicleMutation = useMutation({
    mutationFn: (payload) => api.put(`/admin/captains/${captain._id}/vehicle`, payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['captains'] });
      queryClient.invalidateQueries({ queryKey: ['captain-timeline', captain._id] });
      if (res?.data) onCaptainUpdated?.(res.data);
      setEditVehicleOpen(false);
      toast.success('Dados do veículo atualizados.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao atualizar veículo'),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (payload) => api.put(`/admin/captains/${captain._id}/reset-password`, payload),
    onSuccess: () => {
      setResetPasswordOpen(false);
      toast.success('Senha redefinida. O motorista foi desconectado de todas as sessões.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao redefinir senha'),
  });

  return (
    <div className="space-y-6">
      {/* Alertas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         {(captain.creditBalance ?? 0) < 0 && (
           <div className="p-3 bg-danger/10 border border-danger/20 rounded-xl flex items-start gap-3">
             <AlertTriangle className="w-5 h-5 text-danger mt-0.5" />
             <div>
               <p className="text-sm font-bold text-danger">Créditos negativos</p>
               <p className="text-xs text-danger/80">Ele deve comissão à plataforma. Recarregue os créditos na aba Financeiro para voltar a receber corridas.</p>
             </div>
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
           <div className="flex items-center justify-between mb-4">
             <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted flex items-center gap-2"><Car className="w-4 h-4"/> Veículo</h3>
             <button
               type="button"
               onClick={() => setEditVehicleOpen(true)}
               className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border hover:border-primary hover:text-primary transition-colors"
             >
               <Pencil className="w-3.5 h-3.5" /> Editar
             </button>
           </div>
           <div className="space-y-3">
              <div><p className="text-xs text-text-muted">Categoria</p><p className="font-medium text-sm capitalize">{captain.vehicle?.vehicleType || '—'}</p></div>
              <div><p className="text-xs text-text-muted">Tipo autorizado</p><p className="font-medium text-sm">{vehicleAuthorizationLabel(captain)}</p></div>
              <div><p className="text-xs text-text-muted">Marca / Modelo</p><p className="font-medium text-sm capitalize">{[captain.vehicle?.marca, captain.vehicle?.modelo].filter(Boolean).join(' ') || 'Não informado'}</p></div>
              <div><p className="text-xs text-text-muted">Placa</p><p className="font-bold text-lg uppercase bg-background border border-border px-3 py-1 rounded w-fit mt-1">{captain.vehicle?.plate || '---'}</p></div>
              <div><p className="text-xs text-text-muted">Cor / Ano</p><p className="font-medium text-sm capitalize">{captain.vehicle?.color || '—'} / {captain.vehicle?.ano || '—'}</p></div>
              <div><p className="text-xs text-text-muted">Capacidade</p><p className="font-medium text-sm">{captain.vehicle?.capacity ?? '—'} pessoa(s)</p></div>
           </div>
         </div>

         {/* Segurança */}
         <div className="bg-surface p-5 rounded-xl border border-border">
           <div className="flex items-center justify-between mb-4">
             <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted flex items-center gap-2"><KeyRound className="w-4 h-4"/> Segurança</h3>
           </div>
           <p className="text-xs text-text-muted mb-3">
             Redefina a senha caso o motorista tenha perdido acesso à conta. Todas as sessões ativas dele serão encerradas.
           </p>
           <button
             type="button"
             onClick={() => setResetPasswordOpen(true)}
             className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border hover:border-primary hover:text-primary transition-colors"
           >
             <KeyRound className="w-3.5 h-3.5" /> Redefinir senha
           </button>
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

      {/* Documentação — simplificação do cadastro do motorista (2026-08-04): prazo de
          5 dias calculado no backend (captain.documentDeadline), nunca fixo aqui. */}
      <div className="bg-surface p-5 rounded-xl border border-border">
        <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted mb-4 flex items-center gap-2"><FileText className="w-4 h-4"/> Documentação</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
           <div><p className="text-xs text-text-muted">Cadastrado em</p><p className="font-medium text-sm">{formatDate(captain.createdAt)}</p></div>
           <div><p className="text-xs text-text-muted">Prazo para envio</p><p className="font-medium text-sm">{formatDate(captain.documentDeadline)}</p></div>
           <div>
             <p className="text-xs text-text-muted">Situação</p>
             <StatusBadge className="mt-1" colorClass={statusColor(CAPTAIN_APPROVAL_COLORS, captain.approvalStatus)} label={statusLabel(CAPTAIN_APPROVAL_LABELS, captain.approvalStatus)} />
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

      {editVehicleOpen && (
        <EditCaptainVehicleModal
          captain={captain}
          saving={vehicleMutation.isPending}
          onClose={() => !vehicleMutation.isPending && setEditVehicleOpen(false)}
          onSave={(payload) => vehicleMutation.mutate(payload)}
        />
      )}

      {resetPasswordOpen && (
        <ResetPasswordModal
          captain={captain}
          saving={resetPasswordMutation.isPending}
          onClose={() => !resetPasswordMutation.isPending && setResetPasswordOpen(false)}
          onSave={(payload) => resetPasswordMutation.mutate(payload)}
        />
      )}
    </div>
  )
}

function ResetPasswordModal({ captain, onClose, onSave, saving }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    if (!reason.trim()) {
      setError('Informe o motivo da redefinição.');
      return;
    }
    setError('');
    onSave({ newPassword, reason: reason.trim() });
  };

  return (
    <div className="fixed inset-0 z-[3500] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-surface rounded-xl border border-border w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg text-text">Redefinir senha</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {captain.fullname?.firstname} {captain.fullname?.lastname}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-background rounded-full text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Nova senha</label>
            <input
              required
              type="password"
              minLength={6}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Confirmar nova senha</label>
            <input
              required
              type="password"
              minLength={6}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Motivo da redefinição</label>
            <input
              required
              type="text"
              placeholder="Ex.: motorista perdeu acesso, solicitou por WhatsApp"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <p className="text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
            Ação administrativa sensível: o motorista precisará usar a nova senha no próximo login e todas as sessões ativas dele serão encerradas imediatamente.
          </p>

          <div className="pt-2 flex justify-end gap-3 border-t border-border">
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-text-muted hover:text-text">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:opacity-40"
            >
              {saving ? 'Salvando…' : 'Redefinir senha'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditCaptainVehicleModal({ captain, onClose, onSave, saving }) {
  const v = captain.vehicle || {};
  const [form, setForm] = useState({
    marca: v.marca || '',
    modelo: v.modelo || '',
    ano: v.ano || new Date().getFullYear(),
    color: v.color || '',
    plate: v.plate || '',
    vehicleType: v.vehicleType || '',
    vehicleAuthorization: effectiveVehicleAuthorization(captain) || '',
    reason: '',
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['vehicleCategories'],
    queryFn: async () => {
      const { data } = await api.get('/admin/vehicle-categories');
      return data;
    },
  });

  const activeCategories = (categories || []).filter((c) => c.isActive !== false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (e) => {
    e.preventDefault();
    onSave({
      reason: form.reason.trim() || undefined,
      vehicle: {
        marca: form.marca.trim(),
        modelo: form.modelo.trim(),
        ano: Number(form.ano),
        color: form.color.trim(),
        plate: form.plate.trim().toUpperCase().replace(/[\s-]/g, ''),
        vehicleType: form.vehicleType,
        vehicleAuthorization: form.vehicleAuthorization,
      },
    });
  };

  return (
    <div className="fixed inset-0 z-[3500] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-surface rounded-xl border border-border w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg text-text">Editar veículo</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {captain.fullname?.firstname} {captain.fullname?.lastname}
            </p>
          </div>

          <button type="button" onClick={onClose} className="p-1.5 hover:bg-background rounded-full text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Marca</label>
              <input
                required
                value={form.marca}
                onChange={(e) => set('marca', e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Modelo</label>
              <input
                required
                value={form.modelo}
                onChange={(e) => set('modelo', e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Ano</label>
              <input
                required
                type="number"
                min={1950}
                max={new Date().getFullYear() + 1}
                value={form.ano}
                onChange={(e) => set('ano', e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Cor</label>
              <input
                required
                minLength={3}
                value={form.color}
                onChange={(e) => set('color', e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Placa</label>
              <input
                required
                value={form.plate}
                onChange={(e) => set('plate', e.target.value.toUpperCase())}
                placeholder="ABC1D23"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Categoria</label>
              <select
                required
                value={form.vehicleType}
                onChange={(e) => set('vehicleType', e.target.value)}
                disabled={categoriesLoading}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="">Selecione…</option>
                {activeCategories.map((c) => (
                  <option key={c._id || c.name} value={c.name}>
                    {c.displayName || c.name}
                  </option>
                ))}
                {form.vehicleType && !activeCategories.some((c) => c.name === form.vehicleType) && (
                  <option value={form.vehicleType}>{form.vehicleType} (atual)</option>
                )}
              </select>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="block text-xs font-medium text-text-muted mb-2">Tipo de veículo autorizado</legend>
            {VEHICLE_AUTHORIZATION_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 cursor-pointer hover:border-primary/50">
                <input
                  required
                  type="radio"
                  name="vehicleAuthorization"
                  value={option.value}
                  checked={form.vehicleAuthorization === option.value}
                  onChange={(e) => set('vehicleAuthorization', e.target.value)}
                  className="accent-primary"
                />
                <span className="text-sm font-medium">{option.label}</span>
              </label>
            ))}
          </fieldset>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Motivo da correção (opcional)</label>
            <textarea
              rows={2}
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
              placeholder="Ex.: placa digitada errada no cadastro"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary resize-none"
            />
          </div>

          <p className="text-xs text-text-muted">
            A capacidade é atualizada automaticamente conforme a categoria escolhida. A alteração fica registrada na auditoria.
          </p>

          <div className="pt-2 flex justify-end gap-3 border-t border-border">
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-text-muted hover:text-text">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !form.vehicleType || !form.vehicleAuthorization}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-hover disabled:opacity-40"
            >
              {saving ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TabDocuments({ captainId }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const { data: docs, isLoading } = useQuery({
    queryKey: ['captain-documents', captainId],
    queryFn: async () => { const { data } = await api.get(`/admin/captains/${captainId}/documents`); return data; }
  });

  const verifyMutation = useMutation({
    mutationFn: ({ docType, verified, reason }) => api.put(`/admin/captains/${captainId}/documents/${docType}`, { verified, reason }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['captain-documents', captainId] });
      toast.success(variables.verified ? 'Documento aprovado.' : 'Documento rejeitado.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao verificar documento')
  });

  // Upload direto pelo admin (2026-08-10) — pro caso do motorista mandar o documento
  // por fora (WhatsApp, presencial) e o admin cadastrar em nome dele. Reenviar sempre
  // volta o documento pra "pendente", mesmo que já estivesse aprovado antes.
  const uploadMutation = useMutation({
    mutationFn: ({ docType, file }) => {
      const formData = new FormData();
      formData.append('image', file);
      return api.post(`/admin/captains/${captainId}/documents/${docType}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captain-documents', captainId] });
      queryClient.invalidateQueries({ queryKey: ['captain-document-url', captainId] });
      toast.success('Documento enviado. Fica pendente de verificação novamente.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao enviar documento'),
  });

  if (isLoading) return <div className="p-6 text-center text-text-muted">Carregando documentos...</div>;
  if (!docs) return <div className="p-6 text-center text-text-muted">Nenhum documento encontrado.</div>;

  const handleVerify = async (docType, isVerified) => {
    const reason = await prompt({
      title: isVerified ? 'Aprovar documento' : 'Rejeitar documento',
      message: isVerified ? 'Observação da aprovação (opcional):' : 'Motivo da rejeição:',
      required: !isVerified
    });
    if (reason === null) return; // cancelado
    if (!isVerified && !reason) return; // reason is required for rejection
    verifyMutation.mutate({ docType, verified: isVerified, reason });
  }

  // Auditoria de UX (2026-08-10): upload disparava direto no clique, mas é uma ação
  // destrutiva — apaga o arquivo anterior e derruba a aprovação já concedida, mesmo se
  // o documento já estivesse aprovado. Antes só bloqueio/aprovação pediam confirmação.
  const handleUpload = async (docType, file, hasExisting) => {
    const ok = await confirm({
      title: 'Enviar documento em nome do motorista',
      message: hasExisting
        ? 'Isso substitui o documento atual (o arquivo anterior será apagado) e volta o status para "pendente de verificação", mesmo que já estivesse aprovado. Continuar?'
        : 'O documento ficará pendente de verificação após o envio. Continuar?',
      tone: hasExisting ? 'danger' : 'default',
      confirmLabel: 'Enviar documento',
    });
    if (!ok) return;
    uploadMutation.mutate({ docType, file });
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted mb-4">Checklist Operacional</h3>
      <DocumentRow captainId={captainId} title="CNH Frente" docKey="cnhFront" docData={docs.cnhFront} onVerify={handleVerify} onUpload={handleUpload} uploading={uploadMutation.isPending} />
      <DocumentRow captainId={captainId} title="CNH Verso" docKey="cnhBack" docData={docs.cnhBack} onVerify={handleVerify} onUpload={handleUpload} uploading={uploadMutation.isPending} />
      <DocumentRow captainId={captainId} title="CRLV (Documento Veículo)" docKey="crlv" docData={docs.crlv} onVerify={handleVerify} onUpload={handleUpload} uploading={uploadMutation.isPending} />
      <DocumentRow captainId={captainId} title="Foto do Veículo (Frente)" docKey="vehicleFront" docData={docs.vehicleFront} onVerify={handleVerify} onUpload={handleUpload} uploading={uploadMutation.isPending} />
      <DocumentRow captainId={captainId} title="Selfie de Segurança" docKey="selfie" docData={docs.selfie} onVerify={handleVerify} onUpload={handleUpload} uploading={uploadMutation.isPending} />
    </div>
  )
}

// Auditoria de segurança (2026-08-02, S9): documentos de identidade não ficam mais em
// URL pública, então cada linha busca sua própria URL assinada (expira em 5min) em vez
// de usar docData.url direto. Componente de nível superior (não mais aninhado em
// TabDocuments) para não perder o cache da query a cada render do pai.
function DocumentRow({ captainId, title, docKey, docData, onVerify, onUpload, uploading }) {
  const fileInputRef = React.useRef(null);
  const { data: signedUrl, isLoading: loadingUrl } = useQuery({
    queryKey: ['captain-document-url', captainId, docKey],
    queryFn: async () => {
      const { data } = await api.get(`/admin/captains/${captainId}/documents/${docKey}/url`);
      return data.url;
    },
    enabled: !!docData?.url,
    staleTime: 4 * 60 * 1000 // URL assinada expira em 5min no backend
  });

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reenviar o mesmo arquivo depois, se precisar
    if (file) onUpload(docKey, file, !!docData?.url);
  };

  const uploadButton = (
    <>
      <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-background text-text text-xs font-medium rounded hover:border-primary hover:text-primary transition-colors border border-border disabled:opacity-50"
      >
        <Upload className="w-3.5 h-3.5" /> {uploading ? 'Enviando…' : docData?.url ? 'Reenviar' : 'Enviar'}
      </button>
    </>
  );

  if (!docData || !docData.url) return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-surface rounded-xl border border-border gap-4">
       <div className="flex items-center gap-3"><FileText className="w-5 h-5 text-border" /><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-border">Não enviado</p></div></div>
       <div className="flex gap-2 w-full md:w-auto">{uploadButton}</div>
    </div>
  );
  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-surface rounded-xl border border-border gap-4">
       <div className="flex items-center gap-4">
          <a
            href={signedUrl || undefined}
            target="_blank"
            rel="noreferrer"
            className="w-16 h-12 bg-background border border-border rounded overflow-hidden flex items-center justify-center hover:opacity-80 transition-opacity"
            onClick={(e) => { if (!signedUrl) e.preventDefault(); }}
          >
            {loadingUrl || !signedUrl ? (
              <Clock className="w-4 h-4 text-text-muted animate-pulse" />
            ) : (
              <img src={signedUrl} alt={title} className="w-full h-full object-cover" />
            )}
          </a>
          <div>
             <p className="text-sm font-medium">{title}</p>
             <span className={`text-xs inline-flex items-center gap-1 font-medium mt-1 ${docData.verified ? 'text-primary' : docData.reason ? 'text-danger' : 'text-warning'}`}>
               {docData.verified ? <><Check className="w-3 h-3"/> Aprovado</> : docData.reason ? <><X className="w-3 h-3"/> Rejeitado</> : <><Clock className="w-3 h-3"/> Pendente Verificação</>}
             </span>
             {docData.uploadedAt && (
               <p className="text-xs text-text-muted mt-1">Enviado em {formatDate(docData.uploadedAt)}</p>
             )}
             {/* Motivo salvo em captain.documents.<doc>.reason (2026-08-04) — mesmo texto
                 que o motorista vê no app, evita ter que abrir a aba Auditoria pra conferir. */}
             {!docData.verified && docData.reason && (
               <p className="text-xs text-danger/80 mt-1">{docData.reason}</p>
             )}
          </div>
       </div>
       <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button onClick={() => onVerify(docKey, true)} className="flex-1 md:flex-none px-3 py-1.5 bg-primary/10 text-primary text-xs font-medium rounded hover:bg-primary/20 transition-colors border border-primary/20">Aprovar</button>
          <button onClick={() => onVerify(docKey, false)} className="flex-1 md:flex-none px-3 py-1.5 bg-danger/10 text-danger text-xs font-medium rounded hover:bg-danger/20 transition-colors border border-danger/20">Rejeitar</button>
          {uploadButton}
       </div>
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
                   <StatusBadge colorClass={statusColor(RIDE_STATUS_COLORS, ride.status)} label={statusLabel(RIDE_STATUS_LABELS, ride.status)} />
                 </p>
                 <div className="flex items-center gap-2 mt-2 text-sm text-text-muted">
                    <span>{ride.pickup?.split(',')[0]}</span> <ArrowRight className="w-3 h-3"/> <span>{ride.destination?.split(',')[0]}</span>
                 </div>
              </div>
              <div className="text-left md:text-right">
                 <p className="font-bold text-primary">R$ {(ride.finalPrice ?? ride.fare)?.toFixed(2) || '0.00'}</p>
                 <p className="text-xs text-text-muted">Passageiro: {ride.user?.fullname?.firstname || 'N/A'}</p>
              </div>
           </div>
         ))}
      </div>
    </div>
  )
}

function TabFinance({ captainId, captainName }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustType, setAdjustType] = useState('credit');
  const [adjustReason, setAdjustReason] = useState('');

  const { data: wallet, isLoading } = useQuery({
    queryKey: ['captain-wallet', captainId],
    queryFn: async () => { const { data } = await api.get(`/admin/captains/${captainId}/wallet`); return data; }
  });

  const adjustMutation = useMutation({
    mutationFn: (data) => api.post(`/admin/captains/${captainId}/wallet/adjust`, data),
    onSuccess: (res) => {
      queryClient.setQueryData(['captain-wallet', captainId], (old) => {
        if (!old) return old;
        return {
          ...old,
          balance: res.data.balanceAfter,
          transactions: [res.data.transaction, ...(old.transactions || [])]
        };
      });
      toast.success('Créditos atualizados com sucesso!');
      setShowAdjustModal(false);
      setAdjustAmount('');
      setAdjustReason('');
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Erro ao ajustar saldo');
    }
  });

  const handleAdjust = async (e) => {
    e.preventDefault();
    if (!adjustAmount || Number(adjustAmount) <= 0) return toast.error('Insira um valor válido');
    if (!adjustReason) return toast.error('Insira o motivo');

    const amount = Number(adjustAmount);
    if (amount > 10000) return toast.error('O valor excede o limite (R$ 10.000)');

    const confirmMsg = `Você está ${adjustType === 'credit' ? 'creditando' : 'debitando'} R$ ${amount.toFixed(2)} nos créditos de comissão de ${captainName || 'este motorista'}.\n\nIsso não é o ganho da corrida — só o saldo usado para a plataforma cobrar a comissão.\n\nMotivo: ${adjustReason}`;
    const ok = await confirm({ title: 'Confirmar ajuste de créditos', message: confirmMsg, tone: 'danger', confirmLabel: 'Confirmar ajuste' });
    if (!ok) return;

    adjustMutation.mutate({ amount, type: adjustType, reason: adjustReason });
  };

  if (isLoading) return <div className="p-6 text-center text-text-muted">Carregando dados financeiros...</div>;

  return (
    <div className="space-y-6">
       <div className="bg-background/60 border border-border rounded-xl p-4 text-sm text-text-muted">
          O passageiro paga o motorista na hora. Estes números não são o faturamento da corrida:
          créditos pagam a comissão da MoveCity; “a receber” é o que a plataforma deve a ele (cartão).
       </div>
       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-surface p-6 rounded-xl border border-border flex flex-col items-center justify-center text-center relative">
             <p className="text-sm font-bold uppercase tracking-wider text-text-muted mb-2">Créditos para comissão</p>
             <p className={`text-4xl font-bold ${wallet?.balance < 0 ? 'text-danger' : 'text-primary'}`}>{formatMoney(wallet?.balance)}</p>
             <p className="text-xs text-text-muted mt-2 max-w-xs">Não é o ganho dele. Serve só para a plataforma descontar a comissão depois que o passageiro paga.</p>
             {wallet?.balance < 0 && <p className="text-xs text-danger mt-2 bg-danger/10 px-3 py-1 rounded">Devendo à plataforma — pode bloquear corridas</p>}
             
             <button 
                onClick={() => setShowAdjustModal(true)}
                className="mt-4 px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20 rounded-lg text-sm font-semibold flex items-center gap-2"
             >
                <Activity className="w-4 h-4"/> Ajustar créditos
             </button>
          </div>
          <div className="bg-surface p-5 rounded-xl border border-border space-y-4">
             <div>
                <div className="flex justify-between items-center">
                   <span className="text-sm text-text-muted">A receber (repasse)</span>
                   <span className="font-medium text-warning">{formatMoney(wallet?.pending)}</span>
                </div>
                <p className="text-[11px] text-text-muted mt-1">O que a MoveCity deve a ele em corrida no cartão. Zero em dinheiro/Pix direto.</p>
             </div>
             <div>
                <div className="flex justify-between items-center">
                   <span className="text-sm text-text-muted">Comissão já cobrada</span>
                   <span className="font-medium text-text">{formatMoney(wallet?.commissions)}</span>
                </div>
                <p className="text-[11px] text-text-muted mt-1">Total vitalício — não é saldo e não pode sacar.</p>
             </div>
             <div className="pt-4 border-t border-border">
                <div className="flex justify-between items-center">
                   <span className="text-sm text-text-muted">Última recarga Pix</span>
                   <span className="font-medium text-sm">{wallet?.lastRecharge ? formatDate(wallet.lastRecharge) : 'Nenhuma'}</span>
                </div>
                <p className="text-[11px] text-text-muted mt-1">Ajuste manual do admin não conta como recarga.</p>
             </div>
          </div>
       </div>

       {/* Transaction History */}
       <div className="bg-surface rounded-xl border border-border overflow-hidden">
         <div className="p-4 border-b border-border bg-background/50">
            <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted flex items-center gap-2"><History className="w-4 h-4"/> Extrato</h3>
            <p className="text-[11px] text-text-muted mt-1">Comissão sai dos créditos. Corrida em dinheiro aparece aqui só como registro — o valor já está com o motorista.</p>
         </div>
         <div className="divide-y divide-border">
            {!wallet?.transactions || wallet.transactions.length === 0 ? (
               <div className="p-6 text-center text-text-muted">Nenhuma transação recente.</div>
            ) : (
               wallet.transactions.map((tx) => {
                  const view = describeCaptainLedgerTx(tx);
                  const badgeClass = view.tone === 'debit'
                    ? 'bg-danger/10 text-danger border-danger/20'
                    : view.tone === 'credit'
                      ? 'bg-primary/10 text-primary border-primary/20'
                      : 'bg-background border-border text-text-muted';
                  return (
                  <div key={tx._id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-background/30 transition-colors">
                     <div>
                        <div className="flex items-center gap-2 mb-1">
                           <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${badgeClass}`}>
                              {view.label}
                           </span>
                           <span className="text-xs text-text-muted">{new Date(tx.createdAt).toLocaleString('pt-BR')}</span>
                        </div>
                        <p className="text-sm text-text font-medium">{tx.description || tx.reason}</p>
                        {view.amountHint && <p className="text-xs text-text-muted mt-1">{view.amountHint}</p>}
                        {tx.adminId && <p className="text-xs text-text-muted mt-1">Admin: {tx.adminId}</p>}
                     </div>
                     <div className="text-left md:text-right">
                        <p className={`font-bold ${ledgerToneClass(view.tone)}`}>
                           {formatMoney(view.signedAmount, { showSign: view.tone !== 'info' })}
                        </p>
                        <p className="text-xs text-text-muted mt-1">{view.balanceCaption}: {formatMoney(tx.balanceAfter)}</p>
                     </div>
                  </div>
                  );
               })
            )}
         </div>
       </div>

       {/* Modal de Ajuste */}
       {showAdjustModal && (
         <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 px-4 animate-fade-in">
            <div className="bg-surface w-full max-w-md rounded-2xl border border-border shadow-2xl flex flex-col">
               <div className="p-4 border-b border-border flex justify-between items-center bg-background/50 rounded-t-2xl">
                  <h3 className="font-bold">Ajuste de créditos</h3>
                  <button onClick={() => setShowAdjustModal(false)} className="text-text-muted hover:text-text"><X className="w-5 h-5"/></button>
               </div>
               <form onSubmit={handleAdjust} className="p-6 space-y-4">
                  <p className="text-xs text-text-muted">Altera só os créditos de comissão. Não muda o ganho da corrida nem o valor a receber.</p>
                  <div className="grid grid-cols-2 gap-2">
                     <button type="button" onClick={() => setAdjustType('credit')} className={`py-2 px-4 rounded border text-sm font-bold flex justify-center items-center gap-2 transition-colors ${adjustType === 'credit' ? 'bg-primary/10 border-primary text-primary' : 'bg-background border-border text-text-muted'}`}>
                        + Crédito
                     </button>
                     <button type="button" onClick={() => setAdjustType('debit')} className={`py-2 px-4 rounded border text-sm font-bold flex justify-center items-center gap-2 transition-colors ${adjustType === 'debit' ? 'bg-danger/10 border-danger text-danger' : 'bg-background border-border text-text-muted'}`}>
                        - Débito
                     </button>
                  </div>
                  <div>
                     <label className="block text-xs font-medium text-text-muted mb-1">Valor (R$)</label>
                     <input type="number" step="0.01" min="0.01" max="10000" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} placeholder="0.00" className="w-full bg-background border border-border rounded-lg px-4 py-2 text-lg font-bold text-text focus:outline-none focus:border-primary" required />
                  </div>
                  <div>
                     <label className="block text-xs font-medium text-text-muted mb-1">Motivo / Justificativa</label>
                     <textarea value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="Ex: Correção de pagamento, bonificação..." className="w-full bg-background border border-border rounded-lg px-4 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-[80px]" required></textarea>
                  </div>
                  <div className="pt-2">
                     <button type="submit" disabled={adjustMutation.isPending} className="w-full py-3 bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                        {adjustMutation.isPending ? 'Processando...' : 'Confirmar Ajuste'}
                     </button>
                  </div>
               </form>
            </div>
         </div>
       )}
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
