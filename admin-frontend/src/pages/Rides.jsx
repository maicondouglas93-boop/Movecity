import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useSocket } from '../contexts/SocketContext';
import { 
  Search, MapPin, Navigation, MoreVertical, X, Clock, CreditCard, User, Car, Download, 
  CheckSquare, Square, Filter, ChevronRight, Activity, Map as MapIcon, RotateCcw, AlertTriangle, ShieldAlert
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix leaflet icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Relative time helper
function timeAgo(date) {
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
  requested: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  accepted: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  going_to_pickup: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  arrived: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  started: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  finished: 'bg-green-500/10 text-green-500 border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-500 border-red-500/20',
};

const statusNames = {
  requested: 'Procurando',
  accepted: 'Aceita',
  going_to_pickup: 'A caminho',
  arrived: 'Motorista Chegou',
  started: 'Em andamento',
  finished: 'Finalizada',
  cancelled: 'Cancelada',
};

const fetchRides = async ({ queryKey }) => {
  const [_key, page, filters] = queryKey;
  const params = new URLSearchParams({ page, limit: 15, ...filters });
  const { data } = await api.get(`/admin/rides?${params.toString()}`);
  return data;
};

export default function Rides() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  // States
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: '', status: '', period: 'today', vehicleType: '', paymentMethod: '' });
  const [searchInput, setSearchInput] = useState('');
  const [selectedRides, setSelectedRides] = useState([]);
  const [liveDrivers, setLiveDrivers] = useState({});
  const [activeRideDrawer, setActiveRideDrawer] = useState(null);
  const [showMap, setShowMap] = useState(true); // Split view toggle

  // Query
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rides', page, filters],
    queryFn: fetchRides,
    keepPreviousData: true,
    refetchInterval: 60000 // 60s
  });

  // Socket
  useEffect(() => {
    if (socket) {
      socket.on('admin-captain-location-updated', (data) => {
        setLiveDrivers(prev => ({ ...prev, [data.captainId]: data }));
      });
      // Future: listen for ride status changes to invalidate queries or update local state
    }
    return () => {
      if (socket) socket.off('admin-captain-location-updated');
    };
  }, [socket]);

  // Actions
  const cancelMutation = useMutation({
    mutationFn: (data) => api.put(`/admin/rides/${data.id}/cancel`, { reason: data.reason }),
    onSuccess: () => queryClient.invalidateQueries(['rides'])
  });

  const reassignMutation = useMutation({
    mutationFn: (id) => api.put(`/admin/rides/${id}/reassign`),
    onSuccess: () => queryClient.invalidateQueries(['rides'])
  });

  const bulkActionMutation = useMutation({
    mutationFn: (data) => api.post(`/admin/rides/bulk-action`, data),
    onSuccess: () => {
      setSelectedRides([]);
      queryClient.invalidateQueries(['rides']);
    }
  });

  // Handlers
  const handleSearch = (e) => {
    e.preventDefault();
    setFilters(prev => ({ ...prev, search: searchInput }));
    setPage(1);
  };

  const toggleSelectAll = () => {
    if (selectedRides.length === data?.rides?.length) {
      setSelectedRides([]);
    } else {
      setSelectedRides(data?.rides?.map(r => r._id) || []);
    }
  };

  const toggleSelect = (id) => {
    setSelectedRides(prev => prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]);
  };

  const exportCSV = () => {
    if (!data?.rides) return;
    const items = selectedRides.length > 0 ? data.rides.filter(r => selectedRides.includes(r._id)) : data.rides;
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + "ID,Passageiro,Motorista,Status,Valor,Data\n"
      + items.map(r => `${r._id},${r.user?.fullname?.firstname},${r.captain?.fullname?.firstname || '-'},${r.status},${r.fare},${new Date(r.createdAt).toISOString()}`).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `corridas_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAction = (ride, actionType) => {
    if (actionType === 'cancel') {
      const reason = window.prompt("Motivo do cancelamento:");
      if (reason !== null) cancelMutation.mutate({ id: ride._id, reason });
    } else if (actionType === 'reassign') {
      if (window.confirm("Deseja voltar esta corrida para a fila de busca? O motorista atual será removido.")) {
        reassignMutation.mutate(ride._id);
      }
    } else if (actionType === 'view') {
      setActiveRideDrawer(ride);
    }
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] overflow-hidden bg-background">
      
      {/* MAIN CONTENT (LEFT) */}
      <div className={`flex flex-col flex-1 border-r border-border ${showMap ? 'lg:w-2/3' : 'w-full'} transition-all duration-300`}>
        
        {/* Header & Stats */}
        <div className="p-6 border-b border-border space-y-6 flex-shrink-0 bg-surface">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Centro de Despacho</h1>
              <p className="text-sm text-text-muted mt-1">Monitoramento e operação de corridas em tempo real.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowMap(!showMap)} className="px-3 py-2 bg-background border border-border rounded-lg text-sm flex items-center gap-2 hover:bg-background/80 lg:hidden">
                <MapIcon className="w-4 h-4" /> Mapa
              </button>
            </div>
          </div>

          {/* Quick Stats Summary */}
          {data?.summary && (
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px]">
                <p className="text-xs text-text-muted font-medium mb-1">Solicitadas</p>
                <p className="text-2xl font-bold text-text">{data.summary.requested}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px]">
                <p className="text-xs text-text-muted font-medium mb-1">Em Andamento</p>
                <p className="text-2xl font-bold text-purple-500">{data.summary.ongoing}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px]">
                <p className="text-xs text-text-muted font-medium mb-1">Finalizadas</p>
                <p className="text-2xl font-bold text-green-500">{data.summary.finished}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px]">
                <p className="text-xs text-text-muted font-medium mb-1">Canceladas</p>
                <p className="text-2xl font-bold text-red-500">{data.summary.cancelled}</p>
              </div>
            </div>
          )}

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <form onSubmit={handleSearch} className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Buscar (ID, Status, Nome)..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
            </form>
            
            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.period} onChange={e => { setFilters(f => ({ ...f, period: e.target.value })); setPage(1); }}>
              <option value="today">Hoje</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="all">Todo o período</option>
            </select>
            
            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}>
              <option value="">Status (Todos)</option>
              <option value="requested">Procurando</option>
              <option value="accepted">Em andamento</option>
              <option value="finished">Finalizada</option>
              <option value="cancelled">Cancelada</option>
            </select>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.vehicleType} onChange={e => { setFilters(f => ({ ...f, vehicleType: e.target.value })); setPage(1); }}>
              <option value="">Categoria (Todas)</option>
              <option value="moto">Moto</option>
              <option value="car">Carro</option>
            </select>
          </div>

          {/* Bulk Actions */}
          {selectedRides.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-lg animate-fade-in">
              <span className="text-sm font-medium text-primary">{selectedRides.length} selecionadas</span>
              <div className="h-4 w-px bg-primary/20"></div>
              <button onClick={exportCSV} className="text-sm px-3 py-1 bg-background rounded border border-border flex items-center gap-2 hover:bg-background/80">
                <Download className="w-4 h-4" /> Exportar
              </button>
              <button onClick={() => {
                const reason = window.prompt("Motivo para cancelamento em lote:");
                if(reason) bulkActionMutation.mutate({ rideIds: selectedRides, actionType: 'cancel', reason });
              }} className="text-sm px-3 py-1 bg-danger/10 text-danger rounded border border-danger/20 hover:bg-danger/20">
                Cancelar Lote
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
                    {selectedRides.length > 0 && selectedRides.length === data?.rides?.length ? 
                      <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Viagem</th>
                <th className="px-4 py-3 font-medium">Categoria / PG</th>
                <th className="px-4 py-3 font-medium">Valor / Comis.</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Tempo</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan="7" className="px-6 py-8 text-center text-text-muted">Carregando...</td></tr>
              ) : data?.rides?.length === 0 ? (
                <tr><td colSpan="7" className="px-6 py-8 text-center text-text-muted">Nenhuma corrida encontrada.</td></tr>
              ) : (
                data?.rides?.map((ride) => {
                  const isSelected = selectedRides.includes(ride._id);
                  return (
                    <tr key={ride._id} onClick={() => setActiveRideDrawer(ride)} className={`cursor-pointer hover:bg-surface/50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}>
                      <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => toggleSelect(ride._id)}>
                          {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-text-muted" />}
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-background border border-border flex items-center justify-center flex-shrink-0">
                            <User className="w-4 h-4 text-text-muted" />
                          </div>
                          <div>
                            <p className="font-medium">{ride.user?.fullname?.firstname || 'Passageiro'}</p>
                            <p className="text-xs text-text-muted">{ride.captain?.fullname?.firstname ? `Motorista: ${ride.captain.fullname.firstname}` : 'Buscando motorista...'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-background rounded border border-border capitalize">
                            <Car className="w-3 h-3 text-text-muted" /> {ride.vehicleType}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs text-text-muted capitalize">
                            <CreditCard className="w-3 h-3" /> {ride.paymentMethod}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium text-text">R$ {ride.fare?.toFixed(2)}</p>
                        <p className="text-xs text-text-muted">Comis: R$ {ride.commissionAmount ? ride.commissionAmount.toFixed(2) : '-'}</p>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusColors[ride.status] || 'bg-background'}`}>
                          {statusNames[ride.status] || ride.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs">
                        <p className="text-text">{new Date(ride.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        <p className="text-text-muted">{timeAgo(ride.createdAt)}</p>
                      </td>
                      <td className="px-4 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <RideActionMenu ride={ride} onAction={handleAction} />
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

      {/* MAP VIEW (RIGHT) */}
      {showMap && (
        <div className="hidden lg:flex w-1/3 flex-col bg-surface relative z-0 border-l border-border">
          <div className="absolute top-4 right-4 bg-background/90 backdrop-blur border border-border p-3 rounded-lg shadow-xl z-[1000]">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              {Object.keys(liveDrivers).length} Motoristas Ativos
            </div>
          </div>
          <MapContainer 
            center={[-23.55052, -46.633308]} // SP 
            zoom={12} 
            style={{ height: '100%', width: '100%', backgroundColor: '#18181b' }}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            {Object.values(liveDrivers).map((driver) => (
              <Marker key={driver.captainId} position={[driver.ltd, driver.lng]}>
                <Popup className="custom-popup">Motorista Online</Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}

      {/* RIDE DRAWER */}
      <RideDrawer ride={activeRideDrawer} onClose={() => setActiveRideDrawer(null)} onAction={handleAction} />

    </div>
  );
}

// ==========================================
// SUBCOMPONENTS
// ==========================================

function RideActionMenu({ ride, onAction }) {
  const [open, setOpen] = useState(false);

  // Fecha clicando fora
  useEffect(() => {
    const handleClick = () => setOpen(false);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
      <button 
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-md hover:bg-background border border-transparent hover:border-border transition-colors text-text-muted"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      
      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-surface border border-border rounded-lg shadow-xl z-50 py-1">
          <button onClick={() => onAction(ride, 'view')} className="w-full text-left px-4 py-2 text-sm hover:bg-background flex items-center gap-2">
            <Search className="w-4 h-4" /> Ver Ficha Completa
          </button>
          
          {ride.status === 'requested' && (
            <>
              <button onClick={() => onAction(ride, 'reassign')} className="w-full text-left px-4 py-2 text-sm hover:bg-background flex items-center gap-2 text-warning">
                <RotateCcw className="w-4 h-4" /> Reatribuir
              </button>
            </>
          )}

          {!['cancelled', 'finished'].includes(ride.status) && (
            <button onClick={() => onAction(ride, 'cancel')} className="w-full text-left px-4 py-2 text-sm hover:bg-danger/10 flex items-center gap-2 text-danger">
              <ShieldAlert className="w-4 h-4" /> Cancelar Operação
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RideDrawer({ ride, onClose, onAction }) {
  if (!ride) return null;

  // Fake timeline events for visual demo
  const events = [
    { label: 'Solicitada', time: new Date(ride.createdAt), done: true },
    { label: 'Motorista Aceitou', time: new Date(new Date(ride.createdAt).getTime() + 120000), done: ['accepted', 'going_to_pickup', 'arrived', 'started', 'finished'].includes(ride.status) },
    { label: 'Chegou no local', time: new Date(new Date(ride.createdAt).getTime() + 300000), done: ['arrived', 'started', 'finished'].includes(ride.status) },
    { label: 'Iniciada', time: new Date(new Date(ride.createdAt).getTime() + 360000), done: ['started', 'finished'].includes(ride.status) },
    { label: 'Finalizada', time: new Date(new Date(ride.createdAt).getTime() + 1200000), done: ride.status === 'finished' },
  ];

  if (ride.status === 'cancelled') {
    events.push({ label: 'Cancelada', time: new Date(ride.updatedAt), done: true, isCancel: true });
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[2000] transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[450px] bg-surface border-l border-border shadow-2xl z-[2001] flex flex-col transform transition-transform duration-300 translate-x-0">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-background/50">
          <div>
            <h2 className="text-lg font-bold">Ficha da Corrida</h2>
            <p className="text-xs text-text-muted">ID: {ride._id}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-background rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Status Alert */}
          <div className={`p-4 border rounded-xl flex items-start gap-3 ${statusColors[ride.status] || 'border-border bg-background'}`}>
            <Activity className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm uppercase">{statusNames[ride.status] || ride.status}</p>
              <p className="text-xs mt-1 opacity-80">Atualizado {timeAgo(ride.updatedAt)}</p>
              {ride.status === 'cancelled' && ride.observation && (
                <div className="mt-2 p-2 bg-black/20 rounded border border-white/10 text-xs">
                  <strong>Motivo:</strong> {ride.observation}
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions (Inside Drawer) */}
          {!['cancelled', 'finished'].includes(ride.status) && (
            <div className="flex gap-2">
               <button onClick={() => { onClose(); onAction(ride, 'cancel'); }} className="flex-1 py-2 bg-danger/10 text-danger text-sm font-medium rounded-lg border border-danger/20 hover:bg-danger/20 transition-colors">
                  Cancelar Corrida
               </button>
               {ride.status === 'requested' && (
                 <button onClick={() => { onClose(); onAction(ride, 'reassign'); }} className="flex-1 py-2 bg-warning/10 text-warning text-sm font-medium rounded-lg border border-warning/20 hover:bg-warning/20 transition-colors">
                    Reatribuir
                 </button>
               )}
            </div>
          )}

          {/* Route Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Trajeto</h3>
            <div className="relative pl-6 space-y-4">
              <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border"></div>
              
              <div className="relative">
                <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-primary ring-4 ring-background"></div>
                <p className="text-sm font-medium">{ride.pickup}</p>
                <p className="text-xs text-text-muted">Origem</p>
              </div>
              
              <div className="relative">
                <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-indigo-500 ring-4 ring-background"></div>
                <p className="text-sm font-medium">{ride.destination}</p>
                <p className="text-xs text-text-muted">Destino</p>
              </div>
            </div>
          </div>

          {/* People */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-background p-3 rounded-xl border border-border">
              <p className="text-xs text-text-muted mb-2 uppercase font-semibold">Passageiro</p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center"><User className="w-4 h-4 text-text-muted" /></div>
                <div className="overflow-hidden">
                  <p className="text-sm font-medium truncate">{ride.user?.fullname?.firstname} {ride.user?.fullname?.lastname}</p>
                  <p className="text-xs text-text-muted truncate">{ride.user?.phone}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-background p-3 rounded-xl border border-border">
              <p className="text-xs text-text-muted mb-2 uppercase font-semibold">Motorista</p>
              {ride.captain ? (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center"><Car className="w-4 h-4 text-text-muted" /></div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium truncate">{ride.captain?.fullname?.firstname}</p>
                    <p className="text-xs text-text-muted truncate">{ride.captain?.vehicle?.plate}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-muted italic py-1">Nenhum atribuído</p>
              )}
            </div>
          </div>

          {/* Payment */}
          <div className="space-y-2 bg-background p-4 rounded-xl border border-border">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Financeiro</h3>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Valor da Corrida</span>
              <span className="font-medium text-text">R$ {ride.fare?.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Comissão Plataforma</span>
              <span className="font-medium text-primary">R$ {ride.commissionAmount?.toFixed(2) || '-'}</span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-text-muted">Método</span>
              <span className="font-medium text-text uppercase flex items-center gap-1">
                <CreditCard className="w-4 h-4" /> {ride.paymentMethod}
              </span>
            </div>
          </div>

          {/* Timeline (Simulated for visual) */}
          <div className="space-y-4 pt-4 border-t border-border">
             <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Timeline (Eventos)</h3>
             <div className="space-y-4">
                {events.map((evt, idx) => {
                   if(!evt.done && evt.label !== 'Cancelada' && ride.status === 'cancelled') return null; // Skip pending events if cancelled
                   return (
                     <div key={idx} className={`flex gap-3 ${evt.done ? 'opacity-100' : 'opacity-40'}`}>
                        <div className="flex flex-col items-center">
                           <div className={`w-3 h-3 rounded-full mt-1 ${evt.isCancel ? 'bg-danger' : evt.done ? 'bg-primary' : 'bg-border'}`}></div>
                           {idx < events.length - 1 && <div className={`w-0.5 h-full my-1 ${evt.done ? 'bg-primary/50' : 'bg-border'}`}></div>}
                        </div>
                        <div className="pb-4">
                           <p className={`text-sm font-medium ${evt.isCancel ? 'text-danger' : 'text-text'}`}>{evt.label}</p>
                           {evt.done && <p className="text-xs text-text-muted">{evt.time.toLocaleTimeString()}</p>}
                        </div>
                     </div>
                   )
                })}
             </div>
          </div>

        </div>
      </div>
    </>
  )
}
