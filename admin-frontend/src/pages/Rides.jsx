import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import api from '../services/api';
import { useSocket } from '../contexts/SocketContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePrompt } from '../contexts/PromptContext';
import { buildCsv, downloadCsv } from '../utils/csv';
import { Search, Download, CheckSquare, Square, Map as MapIcon, X, Plus } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import RideRow from '../components/rides/RideRow';
import RideDrawer from '../components/rides/RideDrawer';
import FinalizeRideModal from '../components/rides/FinalizeRideModal';
import ManualRideModal from '../components/rides/ManualRideModal';
import { timeAgo, itemStatusLabel } from '../components/rides/rideUi';

// Fix leaflet icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const DRIVER_STALE_MS = 15 * 60 * 1000; // alinhado ao TTL de disponibilidade do backend
const DEFAULT_MAP_CENTER = [-23.55052, -46.633308];

function driverMarkerIcon(status) {
  const color = status === 'in_ride' ? '#f59e0b' : '#22c55e';
  return L.divIcon({
    className: 'admin-live-driver-marker',
    html: `<div style="width:18px;height:18px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px ${color}55;"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

function FitDriversBounds({ drivers }) {
  const map = useMap();
  // Só reajusta o viewport quando a frota muda (entra/sai), não a cada ping GPS.
  const fleetKey = useMemo(
    () => drivers.map((d) => d.captainId).sort().join('|'),
    [drivers]
  );

  useEffect(() => {
    if (!drivers.length) return;
    if (drivers.length === 1) {
      map.setView([drivers[0].ltd, drivers[0].lng], 14, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(drivers.map((d) => [d.ltd, d.lng]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fleetKey]);

  return null;
}

const fetchLiveMap = async () => {
  const { data } = await api.get('/admin/captains/live-map');
  return data;
};

// Fase 3 da auditoria de production readiness (M3, 2026-08-05): timeAgo, cores/nomes
// de status e os subcomponentes RideRow/RideActionMenu/RideDrawer saíram deste
// arquivo (passava de 780 linhas) para components/rides/ — sem mudança de comportamento.

const fetchRides = async ({ queryKey }) => {
  const [_key, page, filters] = queryKey;
  const params = new URLSearchParams({ page, limit: 15, ...filters });
  const { data } = await api.get(`/admin/rides?${params.toString()}`);
  return data;
};

export default function Rides() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();

  // Estado inicial lido da URL (auditoria de UX, 2026-08-10) — os cards de "Atenção"
  // do Dashboard e os links de outras telas apontam pra cá com filtro pronto (ex.:
  // /rides?status=ongoing); sem isso o link abria a tela mas não filtrava nada.
  const [searchParams] = useSearchParams();

  // States
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    search: '',
    status: searchParams.get('status') || '',
    period: searchParams.get('status') ? 'all' : 'today',
    vehicleType: '',
    paymentMethod: '',
    type: searchParams.get('type') || '',
    source: '',
  });
  const [searchInput, setSearchInput] = useState('');
  const [selectedRides, setSelectedRides] = useState([]);
  const [liveDrivers, setLiveDrivers] = useState({});
  const [mapBootstrapped, setMapBootstrapped] = useState(false);
  const [activeRideDrawer, setActiveRideDrawer] = useState(null);
  const [finalizeRide, setFinalizeRide] = useState(null);
  const [showMap, setShowMap] = useState(true); // Split view toggle
  const [showManualRide, setShowManualRide] = useState(false);

  // Query
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rides', page, filters],
    queryFn: fetchRides,
    placeholderData: keepPreviousData,
    refetchInterval: 60000 // 60s
  });

  // Snapshot inicial: motoristas já online antes de abrir a página
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await fetchLiveMap();
        if (cancelled) return;
        const next = {};
        for (const driver of snapshot.drivers || []) {
          if (driver?.captainId == null || !Number.isFinite(driver.ltd) || !Number.isFinite(driver.lng)) continue;
          next[driver.captainId] = driver;
        }
        setLiveDrivers((prev) => ({ ...next, ...prev })); // socket wins on overlap
        setMapBootstrapped(true);
      } catch {
        if (!cancelled) setMapBootstrapped(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Socket: posição em tempo real + remoção no toggle offline
  useEffect(() => {
    if (!socket) return;

    const onLocation = (payload) => {
      if (!payload?.captainId || !Number.isFinite(payload.ltd) || !Number.isFinite(payload.lng)) return;
      setLiveDrivers((prev) => ({
        ...prev,
        [payload.captainId]: {
          ...prev[payload.captainId],
          ...payload,
          lastSeenAt: payload.lastSeenAt || new Date().toISOString(),
        },
      }));
    };

    const onOffline = (payload) => {
      if (!payload?.captainId) return;
      setLiveDrivers((prev) => {
        if (!prev[payload.captainId]) return prev;
        const next = { ...prev };
        delete next[payload.captainId];
        return next;
      });
    };

    socket.on('admin-captain-location-updated', onLocation);
    socket.on('admin-captain-offline', onOffline);
    return () => {
      socket.off('admin-captain-location-updated', onLocation);
      socket.off('admin-captain-offline', onOffline);
    };
  }, [socket]);

  // Remove motoristas sem heartbeat recente (TTL alinhado ao backend)
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - DRIVER_STALE_MS;
      setLiveDrivers((prev) => {
        let changed = false;
        const next = {};
        for (const [key, driver] of Object.entries(prev)) {
          const seen = driver.lastSeenAt ? new Date(driver.lastSeenAt).getTime() : 0;
          if (seen && seen < cutoff) {
            changed = true;
            continue;
          }
          next[key] = driver;
        }
        return changed ? next : prev;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const liveDriversList = useMemo(
    () => Object.values(liveDrivers).filter((d) => Number.isFinite(d.ltd) && Number.isFinite(d.lng)),
    [liveDrivers]
  );
  const availableCount = useMemo(
    () => liveDriversList.filter((d) => d.status !== 'in_ride').length,
    [liveDriversList]
  );
  const inRideCount = useMemo(
    () => liveDriversList.filter((d) => d.status === 'in_ride').length,
    [liveDriversList]
  );

  // Actions
  // Corrida e encomenda têm endpoints de cancelamento diferentes (auditoria de UX,
  // 2026-08-10, unificação de /rides) — a lista mostra os dois tipos juntos, mas
  // cancelParcelAdmin já existe separado de cancelRide, não foi criado agora.
  const cancelMutation = useMutation({
    mutationFn: (data) => {
      const url = data.serviceType === 'parcel' ? `/admin/parcels/${data.id}/cancel` : `/admin/rides/${data.id}/cancel`;
      return api.put(url, { reason: data.reason });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['rides'] });
      toast.success(variables.serviceType === 'parcel' ? 'Encomenda cancelada.' : 'Corrida cancelada.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao cancelar')
  });

  const reassignMutation = useMutation({
    mutationFn: (id) => api.put(`/admin/rides/${id}/reassign`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rides'] });
      toast.success('Corrida voltou para a fila de busca.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao reatribuir corrida')
  });

  const finalizeMutation = useMutation({
    mutationFn: ({ id, reason, observation }) =>
      api.put(`/admin/rides/${id}/finalize`, { reason, observation }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['rides'] });
      setFinalizeRide(null);
      if (res?.data) setActiveRideDrawer(res.data);
      toast.success('Corrida finalizada pelo administrador.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao finalizar corrida'),
  });

  const bulkActionMutation = useMutation({
    mutationFn: (data) => api.post(`/admin/rides/bulk-action`, data),
    onSuccess: () => {
      setSelectedRides([]);
      queryClient.invalidateQueries({ queryKey: ['rides'] });
      toast.success('Ação em lote aplicada.');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao aplicar ação em lote')
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

    const csvUri = buildCsv(
      ['ID', 'Tipo', 'Cliente', 'Motorista', 'Status', 'Valor Estimado', 'Valor Final', 'Forma de Pagamento', 'Data'],
      items.map(r => [
        r._id,
        r.serviceType === 'parcel' ? 'Encomenda' : 'Corrida',
        r.user?.fullname?.firstname || r.adminPassenger?.name || '',
        r.captain?.fullname?.firstname || '-',
        itemStatusLabel(r),
        r.fare,
        Number.isFinite(r.finalPrice) ? r.finalPrice : '',
        r.paymentMethod,
        new Date(r.createdAt).toISOString(),
      ])
    );
    downloadCsv(csvUri, `corridas_${new Date().getTime()}.csv`);
  };

  const handleAction = async (ride, actionType) => {
    if (actionType === 'cancel') {
      const reason = await prompt({
        message: ride.serviceType === 'parcel' ? 'Motivo do cancelamento da encomenda:' : 'Motivo do cancelamento:',
        required: true,
      });
      if (reason !== null) cancelMutation.mutate({ id: ride._id, reason, serviceType: ride.serviceType });
    } else if (actionType === 'reassign') {
      const ok = await confirm({
        message: 'Deseja voltar esta corrida para a fila de busca? O motorista atual será removido.',
        tone: 'danger',
        confirmLabel: 'Reatribuir'
      });
      if (ok) reassignMutation.mutate(ride._id);
    } else if (actionType === 'finalize') {
      setFinalizeRide(ride);
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
              <button onClick={() => setShowManualRide(true)} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> Lançar corrida</button>
              <button onClick={() => setShowMap(!showMap)} className="px-3 py-2 bg-background border border-border rounded-lg text-sm flex items-center gap-2 hover:bg-background/80 lg:hidden">
                <MapIcon className="w-4 h-4" /> Mapa
              </button>
            </div>
          </div>

          {/* Quick Stats Summary — corrida + encomenda somadas (auditoria de UX, 2026-08-10) */}
          {data?.summary && (
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] cursor-pointer hover:border-warning" onClick={() => { setFilters(f => ({ ...f, status: 'requested' })); setPage(1); }}>
                <p className="text-xs text-text-muted font-medium mb-1">Aguardando motorista</p>
                <p className="text-2xl font-bold text-warning">{data.summary.requested}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] cursor-pointer hover:border-info" onClick={() => { setFilters(f => ({ ...f, status: 'ongoing' })); setPage(1); }}>
                <p className="text-xs text-text-muted font-medium mb-1">Em andamento</p>
                <p className="text-2xl font-bold text-info">{data.summary.ongoing}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] cursor-pointer hover:border-primary" onClick={() => { setFilters(f => ({ ...f, status: 'finished' })); setPage(1); }}>
                <p className="text-xs text-text-muted font-medium mb-1">Concluídas</p>
                <p className="text-2xl font-bold text-primary">{data.summary.finished}</p>
              </div>
              <div className="bg-background border border-border px-4 py-3 rounded-xl min-w-[140px] cursor-pointer hover:border-danger" onClick={() => { setFilters(f => ({ ...f, status: 'cancelled' })); setPage(1); }}>
                <p className="text-xs text-text-muted font-medium mb-1">Canceladas</p>
                <p className="text-2xl font-bold text-danger">{data.summary.cancelled}</p>
              </div>
            </div>
          )}

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <form onSubmit={handleSearch} className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Buscar por ID, status ou nome (cliente/motorista)..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full bg-background border border-border rounded-lg pl-10 pr-4 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
            </form>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.type} onChange={e => { setFilters(f => ({ ...f, type: e.target.value })); setPage(1); }}>
              <option value="">Todos (corridas + encomendas)</option>
              <option value="ride">Só corridas</option>
              <option value="parcel">Só encomendas</option>
            </select>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.source} onChange={e => { setFilters(f => ({ ...f, source: e.target.value, type: e.target.value ? 'ride' : f.type })); setPage(1); }}>
              <option value="">Origem (Todas)</option><option value="passenger">Passageiro</option><option value="admin">ADM</option>
            </select>

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
              <option value="requested">Aguardando motorista</option>
              <option value="ongoing">Em andamento</option>
              <option value="finished">Concluída</option>
              <option value="cancelled">Cancelada</option>
            </select>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.vehicleType} onChange={e => { setFilters(f => ({ ...f, vehicleType: e.target.value })); setPage(1); }}>
              <option value="">Categoria (Todas)</option>
              <option value="moto">Moto</option>
              <option value="car">Carro</option>
            </select>

            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={filters.paymentMethod} onChange={e => { setFilters(f => ({ ...f, paymentMethod: e.target.value })); setPage(1); }}>
              <option value="">Pagamento (Todos)</option>
              <option value="cash">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="card">Cartão</option>
              <option value="carteira">Carteira MoveCity</option>
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
              <button onClick={async () => {
                const reason = await prompt({ message: 'Motivo para cancelamento em lote:', required: true });
                if (reason) bulkActionMutation.mutate({ rideIds: selectedRides, actionType: 'cancel', reason });
              }} disabled={bulkActionMutation.isPending} className="text-sm px-3 py-1 bg-danger/10 text-danger rounded border border-danger/20 hover:bg-danger/20 disabled:opacity-50">
                {bulkActionMutation.isPending ? 'Cancelando...' : 'Cancelar Lote'}
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
                <th className="px-4 py-3 font-medium">Cliente / Motorista</th>
                <th className="px-4 py-3 font-medium">Categoria / Pagamento</th>
                <th className="px-4 py-3 font-medium">Valor / Comissão</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Quando</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan="7" className="px-6 py-8 text-center text-text-muted">Carregando...</td></tr>
              ) : data?.rides?.length === 0 ? (
                <tr><td colSpan="7" className="px-6 py-8 text-center text-text-muted">Nenhuma corrida ou encomenda encontrada.</td></tr>
              ) : (
                data?.rides?.map((ride) => (
                  <RideRow
                    key={ride._id}
                    ride={ride}
                    isSelected={selectedRides.includes(ride._id)}
                    onToggleSelect={toggleSelect}
                    onOpenDrawer={setActiveRideDrawer}
                    onAction={handleAction}
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

      {/* MAP VIEW (RIGHT) — motoristas online em tempo real.
          Bug de UX (auditoria 2026-08-10): o botão "Mapa" (lg:hidden, só aparece no
          mobile) alternava showMap, mas o painel ficava sempre "hidden lg:flex" — ou
          seja, sempre oculto abaixo do breakpoint desktop, com ou sem toggle. No
          mobile o mapa vira overlay de tela cheia; no desktop fica sempre visível
          como painel lateral, independente de showMap (que hoje só existe pro
          mobile, já que não há botão de esconder no desktop). */}
      <div className={`${showMap ? 'fixed inset-0 z-40 flex' : 'hidden'} lg:flex! lg:static lg:z-0 lg:w-1/3 flex-col bg-surface relative border-l border-border`}>
          <button
            type="button"
            onClick={() => setShowMap(false)}
            className="lg:hidden absolute top-4 right-4 z-[1001] p-2 bg-background/90 backdrop-blur border border-border rounded-full shadow-xl"
            aria-label="Fechar mapa"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="absolute top-4 left-4 right-4 flex flex-col gap-2 z-[1000] pointer-events-none">
            <div className="bg-background/90 backdrop-blur border border-border p-3 rounded-lg shadow-xl pointer-events-auto">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  {liveDriversList.length} online
                </div>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500" /> {availableCount} livres
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" /> {inRideCount} em corrida
                  </span>
                </div>
              </div>
              {!mapBootstrapped && (
                <p className="text-xs text-text-muted mt-2">Carregando frota...</p>
              )}
              {mapBootstrapped && liveDriversList.length === 0 && (
                <p className="text-xs text-text-muted mt-2">Nenhum motorista online com GPS no momento.</p>
              )}
            </div>
          </div>
          <MapContainer
            center={DEFAULT_MAP_CENTER}
            zoom={12}
            style={{ height: '100%', width: '100%', backgroundColor: '#18181b' }}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            {/* Congela markers enquanto o modal de corrida manual está aberto —
                React 19 + react-leaflet quebram o DOM (insertBefore) com updates
                de GPS + autocomplete no mesmo commit. */}
            {!showManualRide && (
              <>
                <FitDriversBounds drivers={liveDriversList} />
                {liveDriversList.map((driver) => (
                  <Marker
                    key={driver.captainId}
                    position={[driver.ltd, driver.lng]}
                    icon={driverMarkerIcon(driver.status)}
                  >
                    <Popup>
                      <div className="text-sm space-y-1 min-w-[140px]">
                        <p className="font-semibold">{driver.name || 'Motorista'}</p>
                        <p className="text-xs">
                          {driver.status === 'in_ride' ? 'Em corrida / ocupado' : 'Disponível'}
                        </p>
                        {(driver.vehicle?.plate || driver.vehicle?.vehicleType) && (
                          <p className="text-xs opacity-80">
                            {[driver.vehicle?.vehicleType, driver.vehicle?.plate, driver.vehicle?.color]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                        {driver.lastSeenAt && (
                          <p className="text-[11px] opacity-60">GPS {timeAgo(driver.lastSeenAt)}</p>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </>
            )}
          </MapContainer>
      </div>

      {/* RIDE DRAWER */}
      <RideDrawer ride={activeRideDrawer} onClose={() => setActiveRideDrawer(null)} onAction={handleAction} />

      {finalizeRide && (
        <FinalizeRideModal
          ride={finalizeRide}
          onClose={() => !finalizeMutation.isPending && setFinalizeRide(null)}
          saving={finalizeMutation.isPending}
          onConfirm={({ reason, observation }) =>
            finalizeMutation.mutate({ id: finalizeRide._id, reason, observation })
          }
        />
      )}

      {showManualRide && (
        <ManualRideModal
          onClose={() => setShowManualRide(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['rides'] })}
        />
      )}

    </div>
  );
}
