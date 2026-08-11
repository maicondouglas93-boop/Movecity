import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, MapPin, X } from 'lucide-react';
import api from '../../services/api';
import AdminAddressAutocomplete from '../AdminAddressAutocomplete';
import { formatMoney } from '../../utils/format';

const blankAddress = () => ({ address: '', lat: '', lng: '' });

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `admin-ride-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function addressIsResolved(value) {
  if (value?.lat === '' || value?.lat == null || value?.lng === '' || value?.lng == null) return false;
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  return Boolean(value?.address?.trim())
    && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function passengerDisplayName(user) {
  return [user?.fullname?.firstname, user?.fullname?.lastname].filter(Boolean).join(' ').trim();
}

export default function ManualRideModal({ onClose, onCreated }) {
  const [passengerMode, setPassengerMode] = useState('guest');
  const [passengerSearch, setPassengerSearch] = useState('');
  const [form, setForm] = useState({
    passenger: { name: '', phone: '', passengerCount: 1, note: '' },
    pickup: blankAddress(),
    destination: blankAddress(),
    vehicleType: '',
    paymentMethod: 'cash',
    observation: '',
    captainId: '',
  });
  const [estimate, setEstimate] = useState(null);
  const [result, setResult] = useState(null);
  const idempotencyKeyRef = useRef(newIdempotencyKey());

  const categories = useQuery({
    queryKey: ['manual-ride-categories'],
    queryFn: async () => (await api.get('/admin/vehicle-categories')).data,
  });
  const users = useQuery({
    queryKey: ['manual-ride-users', passengerSearch],
    queryFn: async () => (await api.get('/admin/users', { params: { search: passengerSearch, limit: 8 } })).data,
    enabled: passengerMode === 'registered' && passengerSearch.trim().length >= 2,
  });
  const biasCaptains = useQuery({
    queryKey: ['manual-ride-location-bias'],
    queryFn: async () => (await api.get('/admin/captains', {
      params: { limit: 20, operationalStatus: 'available' },
    })).data,
    staleTime: 60_000,
  });

  const activeCategories = useMemo(
    () => (categories.data?.categories || categories.data || [])
      .filter((category) => category.isActive !== false && category.allowedServices?.ride !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [categories.data],
  );
  useEffect(() => {
    if (activeCategories.length !== 1) return;
    setForm((old) => old.vehicleType ? old : { ...old, vehicleType: activeCategories[0].name });
  }, [activeCategories]);
  const selectedCategory = activeCategories.find((category) => category.name === form.vehicleType);
  const operationBias = useMemo(() => {
    const captain = (biasCaptains.data?.captains || []).find(
      (item) => Number.isFinite(Number(item.location?.ltd)) && Number.isFinite(Number(item.location?.lng)),
    );
    return captain ? { lat: Number(captain.location.ltd), lng: Number(captain.location.lng) } : null;
  }, [biasCaptains.data]);

  const routeKey = [
    form.pickup.address,
    form.pickup.lat,
    form.pickup.lng,
    form.destination.address,
    form.destination.lat,
    form.destination.lng,
    form.vehicleType,
  ].join('|');

  const availableCaptains = useQuery({
    queryKey: ['manual-ride-available-captains', form.pickup.address, form.pickup.lat, form.pickup.lng, form.vehicleType],
    queryFn: async () => (await api.post('/admin/rides/manual/available-captains', {
      pickup: form.pickup.address,
      pickupCoordinates: { lat: form.pickup.lat, lng: form.pickup.lng },
      vehicleType: form.vehicleType,
    })).data,
    enabled: addressIsResolved(form.pickup) && Boolean(form.vehicleType),
    staleTime: 10_000,
    retry: false,
  });

  const estimateMutation = useMutation({
    mutationFn: async () => (await api.post('/admin/rides/manual/estimate', {
      pickup: form.pickup.address,
      destination: form.destination.address,
      pickupCoordinates: { lat: form.pickup.lat, lng: form.pickup.lng },
      destinationCoordinates: { lat: form.destination.lat, lng: form.destination.lng },
      vehicleType: form.vehicleType,
    })).data,
    onSuccess: (data) => setEstimate({ ...data, routeKey }),
  });
  const createMutation = useMutation({
    mutationFn: async () => (await api.post('/admin/rides/manual', {
      ...form,
      idempotencyKey: idempotencyKeyRef.current,
    })).data,
    onSuccess: (ride) => {
      setResult(ride);
      onCreated?.(ride);
    },
  });

  const prepareEditAfterFailure = () => {
    if (!createMutation.isError) return;
    idempotencyKeyRef.current = newIdempotencyKey();
    createMutation.reset();
  };
  const patch = (key, value, { invalidatesEstimate = false } = {}) => {
    prepareEditAfterFailure();
    setForm((old) => ({ ...old, [key]: value }));
    if (invalidatesEstimate) setEstimate(null);
  };
  const patchPassenger = (changes) => {
    prepareEditAfterFailure();
    setForm((old) => ({ ...old, passenger: { ...old.passenger, ...changes } }));
  };
  const updateAddressText = (key, address) => {
    patch(key, { address, lat: '', lng: '' }, { invalidatesEstimate: true });
    if (key === 'pickup') patch('captainId', '');
  };
  const resolveAddress = (key, address, coords) => {
    patch(key, {
      address,
      lat: coords?.lat ?? '',
      lng: coords?.lng ?? '',
    }, { invalidatesEstimate: true });
    if (key === 'pickup') patch('captainId', '');
  };

  const passengerCountValid = !selectedCategory?.capacity
    || Number(form.passenger.passengerCount) <= Number(selectedCategory.capacity);
  const ready = Boolean(
    form.passenger.name.trim()
    && form.passenger.phone.trim()
    && Number(form.passenger.passengerCount) >= 1
    && passengerCountValid
    && addressIsResolved(form.pickup)
    && addressIsResolved(form.destination)
    && form.vehicleType,
  );
  const currentEstimate = estimate?.routeKey === routeKey ? estimate : null;
  const captains = availableCaptains.data?.captains || [];
  const selectedCaptain = captains.find((captain) => captain._id === form.captainId);

  if (result) {
    const offeredCount = result.manualDispatch?.offeredCount;
    return (
      <Shell onClose={onClose}>
        <div className="space-y-5 text-center">
          <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
          <div>
            <h2 className="text-xl font-bold text-text">Corrida lançada com sucesso</h2>
            <p className="text-sm text-text-muted mt-1">ID: {result._id}</p>
          </div>
          <div className="rounded-xl border-2 border-primary bg-primary/10 p-5">
            <div className="flex items-center justify-center gap-2 text-primary">
              <KeyRound className="w-5 h-5" />
              <span className="text-sm font-semibold">PIN para iniciar a corrida</span>
            </div>
            <p className="font-mono text-4xl font-black tracking-[0.2em] mt-2">{result.otp || '—'}</p>
            <p className="text-xs text-text-muted mt-2">Informe este PIN ao passageiro.</p>
          </div>
          {offeredCount === 0 && (
            <Notice tone="warning">
              Nenhum motorista disponível recebeu a oferta agora. A corrida ficou aguardando no sistema.
            </Notice>
          )}
          {result.manualDispatch?.mode === 'selected' && (
            <Notice>Oferta enviada ao motorista selecionado. A corrida será vinculada quando ele aceitar.</Notice>
          )}
          <div className="text-sm text-left rounded-lg border border-border p-4 space-y-1">
            <p><strong>Passageiro:</strong> {form.passenger.name}</p>
            <p><strong>Partida:</strong> {form.pickup.address}</p>
            <p><strong>Destino:</strong> {form.destination.address}</p>
          </div>
          <button type="button" className="w-full py-3 bg-primary text-white rounded-lg font-semibold" onClick={onClose}>
            Fechar
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} closeDisabled={createMutation.isPending}>
      <div className="pr-8">
        <h2 className="text-xl font-bold">Lançar corrida</h2>
        <p className="text-sm text-text-muted mt-1">Confirme cada etapa antes de enviar a oferta aos motoristas.</p>
      </div>

      <div className="space-y-5 max-h-[78vh] overflow-y-auto pr-2 mt-5">
        <Section title="1. Passageiro">
          <div className="flex gap-2 mb-3">
            <ModeButton active={passengerMode === 'guest'} onClick={() => {
              setPassengerMode('guest');
              patchPassenger({ userId: undefined, name: '', phone: '' });
            }}>
              Não cadastrado
            </ModeButton>
            <ModeButton active={passengerMode === 'registered'} onClick={() => {
              setPassengerMode('registered');
              patchPassenger({ userId: undefined, name: '', phone: '' });
            }}>
              Cliente cadastrado
            </ModeButton>
          </div>

          {passengerMode === 'registered' && (
            <div className="mb-3">
              <Input label="Pesquisar por nome, telefone ou e-mail" value={passengerSearch} onChange={setPassengerSearch} />
              {users.isFetching && <p className="text-xs text-text-muted mt-2">Buscando clientes…</p>}
              <div className="space-y-1 mt-2">
                {(users.data?.users || []).map((user) => (
                  <button
                    type="button"
                    key={user._id}
                    className={`w-full text-left p-2 border rounded-lg text-sm ${form.passenger.userId === user._id ? 'border-primary bg-primary/10' : 'border-border'}`}
                    onClick={() => patchPassenger({
                      userId: user._id,
                      name: passengerDisplayName(user),
                      phone: user.phone || '',
                    })}
                  >
                    <strong>{passengerDisplayName(user)}</strong>
                    <span className="text-text-muted"> · {user.phone || user.email}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Nome completo" value={form.passenger.name} onChange={(value) => patchPassenger({ name: value })} />
            <Input label="Telefone com DDD" type="tel" value={form.passenger.phone} onChange={(value) => patchPassenger({ phone: value })} />
            <Input
              label={`Quantidade de passageiros${selectedCategory?.capacity ? ` (máx. ${selectedCategory.capacity})` : ''}`}
              type="number"
              min="1"
              max={selectedCategory?.capacity || 8}
              value={form.passenger.passengerCount}
              onChange={(value) => patchPassenger({ passengerCount: Number(value) })}
            />
            <Input label="Observação do passageiro (opcional)" value={form.passenger.note} onChange={(value) => patchPassenger({ note: value })} />
          </div>
          {!passengerCountValid && <p className="text-xs text-danger mt-2">A quantidade excede a capacidade do veículo.</p>}
        </Section>

        <Section title="2. Partida">
          <Address
            id="manual-ride-pickup"
            value={form.pickup}
            label="Endereço de partida"
            biasLocation={operationBias}
            onTextChange={(address) => updateAddressText('pickup', address)}
            onResolved={(address, coords) => resolveAddress('pickup', address, coords)}
          />
        </Section>

        <Section title="3. Destino">
          <Address
            id="manual-ride-destination"
            value={form.destination}
            label="Endereço de destino"
            biasLocation={addressIsResolved(form.pickup) ? form.pickup : operationBias}
            onTextChange={(address) => updateAddressText('destination', address)}
            onResolved={(address, coords) => resolveAddress('destination', address, coords)}
          />
        </Section>

        <Section title="4. Categoria">
          <select
            aria-label="Categoria do veículo"
            className="field"
            value={form.vehicleType}
            onChange={(event) => {
              const vehicleType = event.target.value;
              prepareEditAfterFailure();
              setForm((old) => ({ ...old, vehicleType, captainId: '' }));
              setEstimate(null);
            }}
          >
            <option value="">Selecione a categoria</option>
            {activeCategories.map((category) => (
              <option key={category._id || category.name} value={category.name}>
                {category.displayName || category.name} · até {category.capacity || 4} passageiro(s)
              </option>
            ))}
          </select>
        </Section>

        <Section title="5. Motorista">
          <select
            aria-label="Motorista"
            className="field"
            value={form.captainId}
            disabled={!addressIsResolved(form.pickup) || !form.vehicleType || availableCaptains.isFetching}
            onChange={(event) => patch('captainId', event.target.value)}
          >
            <option value="">Distribuição automática</option>
            {captains.map((captain) => (
              <option key={captain._id} value={captain._id}>
                {passengerDisplayName(captain)}{captain.distanceKm != null ? ` · ${captain.distanceKm} km da partida` : ''}
              </option>
            ))}
          </select>
          {availableCaptains.isFetching && <p className="text-xs text-text-muted mt-2">Verificando disponibilidade real…</p>}
          {availableCaptains.isError && <p className="text-xs text-danger mt-2">Não foi possível verificar os motoristas. Use a distribuição automática.</p>}
          {availableCaptains.isSuccess && captains.length === 0 && (
            <Notice tone="warning">Nenhum motorista compatível está disponível no raio agora. A distribuição automática ainda pode deixar a corrida aguardando.</Notice>
          )}
        </Section>

        <Section title="6. Pagamento e observação">
          <select aria-label="Forma de pagamento" className="field" value={form.paymentMethod} onChange={(event) => patch('paymentMethod', event.target.value)}>
            <option value="cash">Dinheiro</option>
            <option value="pix">Pix recebido pelo motorista</option>
          </select>
          <p className="text-xs text-text-muted mt-2">Cartão não é oferecido aqui porque o painel ainda não captura o pagamento com segurança.</p>
          <div className="mt-3">
            <Input label="Observação para o motorista (opcional)" value={form.observation} onChange={(value) => patch('observation', value)} />
          </div>
        </Section>

        <Section title="7. Conferência">
          <div className="text-sm space-y-1">
            <p><strong>Passageiro:</strong> {form.passenger.name || '—'} ({form.passenger.passengerCount})</p>
            <p><strong>Partida:</strong> {form.pickup.address || '—'}</p>
            <p><strong>Destino:</strong> {form.destination.address || '—'}</p>
            <p><strong>Motorista:</strong> {selectedCaptain ? passengerDisplayName(selectedCaptain) : 'Distribuição automática'}</p>
            {currentEstimate && (
              <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-2 text-center">
                <SummaryValue label="Distância" value={`${(currentEstimate.distance / 1000).toFixed(1)} km`} />
                <SummaryValue label="Tempo" value={`${Math.max(1, Math.ceil(currentEstimate.time / 60))} min`} />
                <SummaryValue label="Estimativa" value={formatMoney(currentEstimate.fare)} />
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={!ready || estimateMutation.isPending}
            onClick={() => estimateMutation.mutate()}
            className="mt-3 px-3 py-2 border border-primary text-primary rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
          >
            {estimateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {currentEstimate ? 'Recalcular estimativa' : 'Calcular estimativa'}
          </button>
        </Section>

        {(estimateMutation.error || createMutation.error) && (
          <Notice tone="danger">
            {(estimateMutation.error || createMutation.error)?.response?.data?.message || 'Não foi possível concluir. Tente novamente.'}
          </Notice>
        )}

        <button
          type="button"
          disabled={!ready || !currentEstimate || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className="w-full py-3 bg-primary text-white font-bold rounded-lg disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {createMutation.isPending ? 'LANÇANDO…' : 'LANÇAR CORRIDA'}
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose, closeDisabled = false }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Lançar corrida">
      <div className="bg-surface border border-border rounded-xl w-full max-w-3xl p-6 relative shadow-2xl">
        <button type="button" aria-label="Fechar" disabled={closeDisabled} onClick={onClose} className="absolute right-4 top-4 disabled:opacity-40">
          <X />
        </button>
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="border border-border rounded-lg p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Input({ label, value, onChange, type = 'text', min, max }) {
  return (
    <label className="text-xs text-text-muted block">
      {label}
      <input
        className="field mt-1"
        type={type}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Address({ id, value, onTextChange, onResolved, label, biasLocation }) {
  const resolved = addressIsResolved(value);
  return (
    <div>
      <AdminAddressAutocomplete
        id={id}
        label={label}
        value={value.address}
        onChange={onTextChange}
        onResolved={onResolved}
        biasLocation={biasLocation}
        embedCoordinatesInValue={false}
      />
      <p className={`mt-2 text-xs flex items-center gap-1 ${resolved ? 'text-success' : 'text-text-muted'}`}>
        {resolved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
        {resolved ? 'Endereço confirmado no mapa' : 'Escolha uma sugestão da lista para confirmar o ponto exato'}
      </p>
    </div>
  );
}

function ModeButton({ active, onClick, children }) {
  return (
    <button type="button" className={`chip ${active ? 'bg-primary text-white' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function Notice({ children, tone = 'info' }) {
  const classes = tone === 'danger'
    ? 'border-danger/40 bg-danger/10 text-danger'
    : tone === 'warning'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700'
      : 'border-primary/30 bg-primary/10 text-text';
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 text-sm flex gap-2 items-start ${classes}`}>
      {tone === 'warning' || tone === 'danger' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : null}
      <span>{children}</span>
    </div>
  );
}

function SummaryValue({ label, value }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-text-muted">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
