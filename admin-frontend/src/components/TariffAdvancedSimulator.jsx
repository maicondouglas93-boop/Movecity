import React, { useEffect, useRef, useState } from 'react';
import { Calculator, ChevronDown, ChevronUp, MapPin, TrendingUp } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api';
import AdminAddressAutocomplete from './AdminAddressAutocomplete';
import { estimateRoute, parseAddressCoords } from '../services/mapsApi';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const SERVICE_KINDS = [
  { id: 'ride', label: 'Corrida' },
  { id: 'presential', label: 'Presencial' },
  { id: 'parcel', label: 'Encomenda' },
];

const DEFAULT_CENTER = [-23.5505, -46.6333];

/**
 * Leaflet imperativo: React só dono do container vazio.
 * Evita NotFoundError removeChild do react-leaflet + React 19.
 */
function SimulatorRouteMap({ pickupCoords, destCoords, polyline }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({ pickup: null, dest: null, line: null });
  const hasRoute = Boolean(pickupCoords || destCoords || (polyline && polyline.length > 1));

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return undefined;

    const map = L.map(el, {
      center: DEFAULT_CENTER,
      zoom: 12,
      scrollWheelZoom: false,
      zoomControl: true,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OSM &copy; CARTO',
    }).addTo(map);
    mapRef.current = map;

    const onResize = () => {
      try { map.invalidateSize(); } catch { /* ignore */ }
    };
    const t = setTimeout(onResize, 80);
    window.addEventListener('resize', onResize);

    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
      try { map.remove(); } catch { /* ignore */ }
      mapRef.current = null;
      layersRef.current = { pickup: null, dest: null, line: null };
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layers = layersRef.current;
    const clearLayer = (key) => {
      if (layers[key]) {
        try { map.removeLayer(layers[key]); } catch { /* ignore */ }
        layers[key] = null;
      }
    };

    clearLayer('pickup');
    clearLayer('dest');
    clearLayer('line');

    const boundsPts = [];

    if (pickupCoords) {
      layers.pickup = L.marker([pickupCoords.lat, pickupCoords.lng]).addTo(map);
      boundsPts.push([pickupCoords.lat, pickupCoords.lng]);
    }
    if (destCoords) {
      layers.dest = L.marker([destCoords.lat, destCoords.lng]).addTo(map);
      boundsPts.push([destCoords.lat, destCoords.lng]);
    }
    if (polyline?.length > 1) {
      layers.line = L.polyline(polyline, { color: '#3b82f6', weight: 4 }).addTo(map);
      polyline.forEach((p) => boundsPts.push(p));
    }

    try {
      map.invalidateSize();
      if (boundsPts.length === 1) {
        map.setView(boundsPts[0], 14);
      } else if (boundsPts.length > 1) {
        map.fitBounds(L.latLngBounds(boundsPts), { padding: [28, 28], maxZoom: 15 });
      }
    } catch {
      /* mapa destruído */
    }
  }, [pickupCoords, destCoords, polyline]);

  return (
    <div className="rounded-lg overflow-hidden border border-border h-[220px] bg-background relative z-0">
      <div ref={containerRef} className="h-full w-full" />
      {!hasRoute && (
        <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-2 bg-background/90 px-4 text-center pointer-events-none">
          <MapPin className="w-7 h-7 opacity-40 text-text-muted" />
          <span className="text-xs text-text-muted">
            Escolha partida e destino no autocomplete para traçar a rota e calcular o valor.
          </span>
        </div>
      )}
    </div>
  );
}

export default function TariffAdvancedSimulator({
  values,
  vehicleType,
  platformCommission = 20,
}) {
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState(null);
  const [destCoords, setDestCoords] = useState(null);
  const [polyline, setPolyline] = useState([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [showManual, setShowManual] = useState(false);

  const [distance, setDistance] = useState(10);
  const [time, setTime] = useState(20);
  const [waitTime, setWaitTime] = useState(0);
  const [extraStops, setExtraStops] = useState(0);
  const [dailyRides, setDailyRides] = useState(100);
  const [serviceKind, setServiceKind] = useState('ride');
  const [selectedOptionals, setSelectedOptionals] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const categoryOptionals = values?.optionals || [];
  const commPct = parseFloat(values?.platformCommission) || platformCommission;

  const resolvePickup = (formatted, coords) => {
    setPickup(formatted);
    setPickupCoords(coords || parseAddressCoords(formatted));
  };

  const resolveDestination = (formatted, coords) => {
    setDestination(formatted);
    setDestCoords(coords || parseAddressCoords(formatted));
  };

  useEffect(() => {
    const origin = pickup.trim();
    const dest = destination.trim();
    const oCoords = pickupCoords || parseAddressCoords(origin);
    const dCoords = destCoords || parseAddressCoords(destination);
    // Só estima após autocomplete resolver coords (evita spam enquanto digita)
    if (!oCoords || !dCoords || origin.length < 3 || dest.length < 3) return undefined;

    const timer = setTimeout(async () => {
      setRouteLoading(true);
      setRouteError('');
      try {
        const data = await estimateRoute(origin, dest);
        setDistance(Number(data.distanceKm) || 0);
        setTime(Number(data.durationMin) || 1);
        setPolyline(Array.isArray(data.polyline) ? data.polyline : []);
        if (!pickupCoords) setPickupCoords(oCoords);
        if (!destCoords) setDestCoords(dCoords);
      } catch (err) {
        setPolyline([]);
        setRouteError(err.response?.data?.message || 'Não foi possível calcular a rota');
      } finally {
        setRouteLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [pickup, destination, pickupCoords, destCoords]);

  useEffect(() => {
    if (!vehicleType || !values) return undefined;

    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await api.post('/admin/tariffs/simulate', {
          distance,
          time,
          vehicleType,
          serviceKind,
          waitTimeSeconds: waitTime,
          extraStopsCount: extraStops,
          optionals: selectedOptionals,
          customPricing: values,
        });
        setResult(data);
      } catch (err) {
        setResult(null);
        setError(err.response?.data?.message || 'Falha na simulação');
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [
    distance,
    time,
    waitTime,
    extraStops,
    serviceKind,
    selectedOptionals,
    vehicleType,
    values,
  ]);

  const breakdown = result?.fareBreakdown || {};
  const surcharges = breakdown.surcharges || {};
  const total = result?.finalFare ?? 0;
  const platformFee = result?.commissionAmount ?? 0;
  const driverEarnings = result?.driverEarnings ?? 0;
  const parcelAdj = Number(surcharges.parcelAdjustment) || 0;

  const estimatedRevenue = total * dailyRides;
  const estimatedPlatformRevenue = platformFee * dailyRides;

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden flex flex-col h-full shadow-lg">
      <div className="bg-primary/10 border-b border-border p-4 flex items-center gap-2">
        <Calculator className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg text-primary">Simulador</h3>
      </div>

      <div className="p-5 space-y-4 flex-1 overflow-y-auto no-scrollbar">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Tipo de serviço</label>
          <select
            value={serviceKind}
            onChange={(e) => setServiceKind(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
          >
            {SERVICE_KINDS.map((sk) => (
              <option key={sk.id} value={sk.id}>{sk.label}</option>
            ))}
          </select>
        </div>

        <AdminAddressAutocomplete
          id="sim-pickup"
          label="Partida"
          value={pickup}
          onChange={(v) => {
            setPickup(v);
            setPickupCoords(parseAddressCoords(v));
          }}
          onResolved={resolvePickup}
          placeholder="Endereço de partida"
        />

        <AdminAddressAutocomplete
          id="sim-destination"
          label="Destino"
          value={destination}
          onChange={(v) => {
            setDestination(v);
            setDestCoords(parseAddressCoords(v));
          }}
          onResolved={resolveDestination}
          placeholder="Endereço de destino"
          biasLocation={pickupCoords}
        />

        <div className="relative">
          <SimulatorRouteMap
            pickupCoords={pickupCoords}
            destCoords={destCoords}
            polyline={polyline}
          />
          {routeLoading && (
            <div className="absolute inset-x-0 bottom-0 z-[600] bg-background/80 text-xs text-center py-1 text-text-muted rounded-b-lg">
              Calculando rota…
            </div>
          )}
        </div>

        {routeError && <p className="text-sm text-danger">{routeError}</p>}

        {(pickup || destination) && (
          <p className="text-xs text-text-muted">
            Rota: {distance} km · {time} min
            {routeLoading ? ' (atualizando…)' : ''}
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-primary transition-colors"
        >
          {showManual ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Ajuste manual (km / min / extras)
        </button>

        {showManual && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Distância (km)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={distance}
                onChange={(e) => setDistance(Number(e.target.value) || 0)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Tempo (min)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={time}
                onChange={(e) => setTime(Number(e.target.value) || 0)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Tempo de Espera (min)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={waitTime}
                onChange={(e) => setWaitTime(Number(e.target.value) || 0)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Paradas Extras</label>
              <input
                type="number"
                min="0"
                step="1"
                value={extraStops}
                onChange={(e) => setExtraStops(Number(e.target.value) || 0)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
              />
            </div>
          </div>
        )}

        {!showManual && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Tempo de Espera (min)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={waitTime}
                onChange={(e) => setWaitTime(Number(e.target.value) || 0)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Paradas Extras</label>
              <input
                type="number"
                min="0"
                step="1"
                value={extraStops}
                onChange={(e) => setExtraStops(Number(e.target.value) || 0)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
              />
            </div>
          </div>
        )}

        {categoryOptionals.length > 0 && (
          <div className="pt-1">
            <label className="block text-xs font-medium text-text-muted mb-2">Simular Adicionais</label>
            <div className="flex flex-wrap gap-2">
              {categoryOptionals.filter((o) => o.isActive).map((opt) => (
                <label key={opt.id} className="flex items-center gap-1.5 bg-background border border-border px-2 py-1 rounded-md cursor-pointer hover:border-primary transition-colors">
                  <input
                    type="checkbox"
                    checked={!!selectedOptionals[opt.id]}
                    onChange={(e) => setSelectedOptionals((prev) => ({ ...prev, [opt.id]: e.target.checked }))}
                  />
                  <span className="text-xs font-medium">{opt.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
        {loading && !result && <p className="text-sm text-text-muted">Calculando…</p>}

        <div className="space-y-2 text-sm pt-2">
          <div className="flex justify-between">
            <span className="text-text-muted">Base Tarifária</span>
            <span>R$ {(Number(breakdown.baseFare) || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Distância ({distance} km)</span>
            <span>R$ {(Number(breakdown.distanceFare) || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Tempo ({time} min)</span>
            <span>R$ {(Number(breakdown.timeFare) || 0).toFixed(2)}</span>
          </div>

          {(Number(breakdown.minimumFareAdjustment) || 0) > 0 && (
            <div className="flex justify-between text-danger font-medium bg-danger/10 px-2 py-1 rounded">
              <span>Ajuste Tarifa Mínima</span>
              <span>+ R$ {(Number(breakdown.minimumFareAdjustment) || 0).toFixed(2)}</span>
            </div>
          )}

          {(Number(surcharges.waiting) || 0) > 0 && (
            <div className="flex justify-between text-warning">
              <span>Taxa de Espera</span>
              <span>R$ {(Number(surcharges.waiting) || 0).toFixed(2)}</span>
            </div>
          )}

          {(Number(surcharges.extraStops) || 0) > 0 && (
            <div className="flex justify-between text-warning">
              <span>Paradas Extras</span>
              <span>R$ {(Number(surcharges.extraStops) || 0).toFixed(2)}</span>
            </div>
          )}

          {(Number(surcharges.optionals) || 0) > 0 && (
            <div className="flex justify-between text-warning">
              <span>Adicionais</span>
              <span>R$ {(Number(surcharges.optionals) || 0).toFixed(2)}</span>
            </div>
          )}

          {serviceKind === 'parcel' && (
            <div className="flex justify-between text-warning">
              <span>Acréscimo de encomenda</span>
              <span>R$ {parcelAdj.toFixed(2)}</span>
            </div>
          )}

          {(Number(surcharges.globalTariffs) || 0) > 0 && (
            <div className="flex justify-between text-warning">
              <span>Tarifas globais</span>
              <span>R$ {(Number(surcharges.globalTariffs) || 0).toFixed(2)}</span>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-success font-medium">Motorista Recebe ({(100 - (result?.commissionPercent ?? commPct)).toFixed(0)}%)</span>
            <span className="text-success">R$ {driverEarnings.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-primary font-medium">Plataforma Recebe ({(result?.commissionPercent ?? commPct).toFixed(0)}%)</span>
            <span className="text-primary">R$ {platformFee.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="bg-background border-t border-border p-5">
        <div className="flex justify-between items-end mb-4">
          <span className="text-text-muted font-medium">Passageiro Paga</span>
          <span className="text-3xl font-bold text-text">R$ {total.toFixed(2)}</span>
        </div>

        <div className="bg-surface border border-border rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-1.5 text-text-muted mb-1 text-xs font-semibold uppercase tracking-wider">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Projeção de Faturamento Diário</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-[10px] text-text-muted uppercase">Serviços/Dia</label>
              <input type="number" min="1" value={dailyRides} onChange={(e) => setDailyRides(Number(e.target.value) || 0)} className="w-full bg-background border border-border rounded px-2 py-1 text-sm text-text focus:border-primary outline-none mt-1" />
            </div>
            <div className="flex-1 text-right">
              <label className="block text-[10px] text-text-muted uppercase">Receita Bruta</label>
              <div className="font-semibold text-text mt-1.5">R$ {estimatedRevenue.toFixed(0)}</div>
            </div>
            <div className="flex-1 text-right">
              <label className="block text-[10px] text-primary uppercase">Receita Plataforma</label>
              <div className="font-bold text-primary mt-1.5">R$ {estimatedPlatformRevenue.toFixed(0)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
