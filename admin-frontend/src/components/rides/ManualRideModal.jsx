import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import api from '../../services/api';
import AdminAddressAutocomplete from '../AdminAddressAutocomplete';
import { formatMoney } from '../../utils/format';

const emptyAddress = { address: '', lat: '', lng: '' };

export default function ManualRideModal({ onClose, onCreated }) {
  const [passengerMode, setPassengerMode] = useState('guest');
  const [passengerSearch, setPassengerSearch] = useState('');
  const [form, setForm] = useState({ passenger: { name: '', phone: '', passengerCount: 1, note: '' }, pickup: emptyAddress, destination: emptyAddress, vehicleType: '', paymentMethod: 'cash', observation: '', captainId: '' });
  const [estimate, setEstimate] = useState(null);
  const [result, setResult] = useState(null);
  const categories = useQuery({ queryKey: ['manual-ride-categories'], queryFn: async () => (await api.get('/admin/vehicle-categories')).data });
  const users = useQuery({ queryKey: ['manual-ride-users', passengerSearch], queryFn: async () => (await api.get('/admin/users', { params: { search: passengerSearch, limit: 8 } })).data, enabled: passengerMode === 'registered' && passengerSearch.length >= 2 });
  const captains = useQuery({ queryKey: ['manual-ride-captains'], queryFn: async () => (await api.get('/admin/captains', { params: { limit: 100, isOnline: true } })).data });
  const activeCategories = useMemo(() => (categories.data?.categories || categories.data || []).filter((c) => c.isActive !== false && (!c.services || c.services.ride !== false)), [categories.data]);
  const patch = (key, value) => setForm((old) => ({ ...old, [key]: value }));

  const estimateMutation = useMutation({ mutationFn: async () => (await api.post('/admin/rides/manual/estimate', { pickup: form.pickup.address, destination: form.destination.address, vehicleType: form.vehicleType })).data, onSuccess: setEstimate });
  const createMutation = useMutation({
    mutationFn: async () => (await api.post('/admin/rides/manual', { ...form, idempotencyKey: crypto.randomUUID() })).data,
    onSuccess: (ride) => { setResult(ride); onCreated?.(ride); },
  });
  const ready = form.passenger.name && form.passenger.phone && form.pickup.address && form.pickup.lat !== '' && form.destination.address && form.destination.lat !== '' && form.vehicleType;

  if (result) return <Shell onClose={onClose}><div className="space-y-4 text-center"><h2 className="text-xl font-bold text-success">Corrida lançada com sucesso</h2><p className="text-sm">ID: <strong>{result._id}</strong></p><p>{form.passenger.name} → {form.destination.address}</p><p className="text-text-muted">{result.captain?.fullname?.firstname || 'Aguardando motorista'}</p><button className="px-5 py-2 bg-primary text-white rounded-lg" onClick={onClose}>Fechar</button></div></Shell>;

  return <Shell onClose={onClose}>
    <h2 className="text-xl font-bold mb-4">Lançar corrida</h2>
    <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-2">
      <Section title="1. Passageiro">
        <div className="flex gap-2 mb-3"><button className={`chip ${passengerMode === 'guest' ? 'bg-primary text-white' : ''}`} onClick={() => setPassengerMode('guest')}>Não cadastrado</button><button className={`chip ${passengerMode === 'registered' ? 'bg-primary text-white' : ''}`} onClick={() => setPassengerMode('registered')}>Cliente cadastrado</button></div>
        {passengerMode === 'registered' && <><Input label="Pesquisar cliente" value={passengerSearch} onChange={setPassengerSearch}/><div className="space-y-1">{(users.data?.users || []).map((u) => <button key={u._id} className="w-full text-left p-2 border border-border rounded" onClick={() => patch('passenger', { ...form.passenger, userId: u._id, name: `${u.fullname?.firstname || ''} ${u.fullname?.lastname || ''}`.trim(), phone: u.phone || '' })}>{u.fullname?.firstname} {u.fullname?.lastname} — {u.phone}</button>)}</div></>}
        <div className="grid sm:grid-cols-2 gap-3"><Input label="Nome" value={form.passenger.name} onChange={(v) => patch('passenger', { ...form.passenger, name: v })}/><Input label="Telefone" value={form.passenger.phone} onChange={(v) => patch('passenger', { ...form.passenger, phone: v })}/><Input label="Quantidade" type="number" value={form.passenger.passengerCount} onChange={(v) => patch('passenger', { ...form.passenger, passengerCount: Number(v) })}/><Input label="Observação do passageiro" value={form.passenger.note} onChange={(v) => patch('passenger', { ...form.passenger, note: v })}/></div>
      </Section>
      <Section title="2. Partida"><Address value={form.pickup} onChange={(v) => patch('pickup', v)} label="Endereço de partida" /></Section>
      <Section title="3. Destino"><Address value={form.destination} onChange={(v) => patch('destination', v)} label="Endereço de destino" /></Section>
      <Section title="4. Veículo"><select className="field" value={form.vehicleType} onChange={(e) => { patch('vehicleType', e.target.value); setEstimate(null); }}><option value="">Selecione a categoria</option>{activeCategories.map((c) => <option key={c._id || c.name} value={c.name}>{c.displayName || c.name}</option>)}</select></Section>
      <Section title="5. Motorista"><select className="field" value={form.captainId} onChange={(e) => patch('captainId', e.target.value)}><option value="">Distribuição automática</option>{(captains.data?.captains || []).map((c) => <option key={c._id} value={c._id}>{c.fullname?.firstname} — {c.vehicle?.vehicleType} — {c.isOnline ? 'online' : 'offline'}</option>)}</select></Section>
      <Section title="6. Pagamento"><select className="field" value={form.paymentMethod} onChange={(e) => patch('paymentMethod', e.target.value)}><option value="cash">Dinheiro</option><option value="pix">Pix</option><option value="card">Cartão</option></select><div className="mt-3"><Input label="Observação para o motorista" value={form.observation} onChange={(v) => patch('observation', v)}/></div></Section>
      <Section title="7. Resumo"><div className="text-sm space-y-1"><p><b>Passageiro:</b> {form.passenger.name || '—'} ({form.passenger.passengerCount})</p><p><b>Partida:</b> {form.pickup.address || '—'}</p><p><b>Destino:</b> {form.destination.address || '—'}</p><p><b>Motorista:</b> {form.captainId ? 'Selecionado' : 'Automático'}</p>{estimate && <><p><b>Distância:</b> {(estimate.distance / 1000).toFixed(1)} km</p><p><b>Tempo:</b> {Math.ceil(estimate.time / 60)} min</p><p><b>Estimativa:</b> {formatMoney(form.paymentMethod === 'card' ? estimate.fareCard : estimate.fare)}</p></>}</div><button disabled={!ready || estimateMutation.isPending} onClick={() => estimateMutation.mutate()} className="mt-3 px-3 py-2 border border-primary text-primary rounded disabled:opacity-50">Calcular estimativa</button></Section>
      {(estimateMutation.error || createMutation.error) && <p className="text-danger text-sm">{(estimateMutation.error || createMutation.error)?.response?.data?.message || 'Não foi possível concluir.'}</p>}
      <button disabled={!ready || !estimate || createMutation.isPending} onClick={() => createMutation.mutate()} className="w-full py-3 bg-primary text-white font-bold rounded-lg disabled:opacity-50">{createMutation.isPending ? 'LANÇANDO…' : 'LANÇAR CORRIDA'}</button>
    </div>
  </Shell>;
}

function Shell({ children, onClose }) { return <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"><div className="bg-surface border border-border rounded-xl w-full max-w-3xl p-6 relative shadow-2xl"><button aria-label="Fechar" onClick={onClose} className="absolute right-4 top-4"><X /></button>{children}</div></div>; }
function Section({ title, children }) { return <section className="border border-border rounded-lg p-4"><h3 className="font-semibold mb-3">{title}</h3>{children}</section>; }
function Input({ label, value, onChange, type = 'text' }) { return <label className="text-xs text-text-muted block">{label}<input className="field mt-1" type={type} value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
function Address({ value, onChange, label }) { return <div><AdminAddressAutocomplete label={label} value={value.address} onChange={(address) => onChange({ ...value, address })} onResolved={(address, coords) => onChange({ address, lat: coords?.lat ?? '', lng: coords?.lng ?? '' })}/><div className="grid grid-cols-2 gap-3 mt-2"><Input label="Latitude" type="number" value={value.lat} onChange={(lat) => onChange({ ...value, lat })}/><Input label="Longitude" type="number" value={value.lng} onChange={(lng) => onChange({ ...value, lng })}/></div></div>; }
