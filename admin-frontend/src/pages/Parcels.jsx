import React, { useEffect, useState } from 'react';
import api from '../services/api';

const STATUS_LABEL = {
  awaiting_provider: 'Aguardando',
  provider_accepted: 'Aceita',
  going_to_pickup: 'Indo retirada',
  arrived_pickup: 'Na retirada',
  collected: 'Coletada',
  in_transit: 'Em transporte',
  arrived_destination: 'No destino',
  delivered: 'Entregue',
  finished: 'Finalizada',
  cancelled: 'Cancelada',
  scheduled: 'Agendada',
};

const EMPTY_OPS = {
  maxWeightKg: 10,
  maxPackageSize: 'medium',
  requireDeliveryPin: true,
  blockIncompatibleVehicle: true,
};

const normalizeSettings = (raw) => {
  const dp = raw?.deliveryPricing || {};
  return {
    ...raw,
    deliveryPricing: {
      moto: { ...EMPTY_OPS, maxWeightKg: 10, maxPackageSize: 'medium', ...pickOps(dp.moto) },
      car: { ...EMPTY_OPS, maxWeightKg: 50, maxPackageSize: 'large', ...pickOps(dp.car) },
    },
  };
};

function pickOps(block = {}) {
  return {
    maxWeightKg: block.maxWeightKg,
    maxPackageSize: block.maxPackageSize,
    requireDeliveryPin: block.requireDeliveryPin,
    blockIncompatibleVehicle: block.blockIncompatibleVehicle,
  };
}

function VehicleOpsCard({ title, vehicleKey, pricing, onChange }) {
  const set = (key, value) => onChange(vehicleKey, { ...pricing, [key]: value });

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3 flex-1 min-w-[280px]">
      <h3 className="font-semibold text-text">{title}</h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-text-muted">Peso máximo (kg)</span>
          <input
            type="number"
            step="0.1"
            min="0"
            className="border border-border rounded-lg px-3 py-2 bg-background"
            value={pricing.maxWeightKg ?? ''}
            onChange={(e) => set('maxWeightKg', Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-muted">Tamanho máximo</span>
          <select
            className="border border-border rounded-lg px-3 py-2 bg-background"
            value={pricing.maxPackageSize || 'medium'}
            onChange={(e) => set('maxPackageSize', e.target.value)}
          >
            <option value="small">Pequeno</option>
            <option value="medium">Médio</option>
            <option value="large">Grande</option>
          </select>
        </label>
        <label className="flex items-center gap-2 col-span-2">
          <input
            type="checkbox"
            checked={!!pricing.requireDeliveryPin}
            onChange={(e) => set('requireDeliveryPin', e.target.checked)}
          />
          Exigir PIN na entrega
        </label>
        <label className="flex items-center gap-2 col-span-2">
          <input
            type="checkbox"
            checked={!!pricing.blockIncompatibleVehicle}
            onChange={(e) => set('blockIncompatibleVehicle', e.target.checked)}
          />
          Bloquear veículo incompatível (peso/tamanho)
        </label>
      </div>
    </div>
  );
}

export default function Parcels() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [listRes, settingsRes] = await Promise.all([
        api.get('/admin/parcels', { params: status ? { status } : {} }),
        api.get('/admin/parcel-settings'),
      ]);
      setItems(listRes.data.items || []);
      setSettings(normalizeSettings(settingsRes.data));
    } catch (err) {
      console.error(err);
      setSaveMsg(err.response?.data?.message || 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);

  const cancel = async (id) => {
    if (!window.confirm('Cancelar esta encomenda?')) return;
    await api.put(`/admin/parcels/${id}/cancel`, { reason: 'Cancelado pelo admin' });
    load();
  };

  const patchVehicle = (vehicleKey, nextPricing) => {
    setSettings((prev) => ({
      ...prev,
      deliveryPricing: {
        ...prev.deliveryPricing,
        [vehicleKey]: nextPricing,
      },
    }));
  };

  const saveSettings = async () => {
    if (!settings?.deliveryPricing) return;
    setSaving(true);
    setSaveMsg('');
    try {
      // Só regras operacionais — preço fica em Tarifas por categoria.
      const { data } = await api.put('/admin/parcel-settings', {
        deliveryPricing: {
          moto: pickOps(settings.deliveryPricing.moto),
          car: pickOps(settings.deliveryPricing.car),
        },
      });
      setSettings(normalizeSettings(data));
      setSaveMsg('Regras operacionais salvas. Preços de encomenda ficam em Tarifas por categoria.');
    } catch (err) {
      console.error(err);
      setSaveMsg(err.response?.data?.message || 'Erro ao salvar (verifique se você é super_admin).');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text">Encomendas</h1>
        <p className="text-sm text-text-muted mt-1">
          Listagem e regras operacionais (peso, tamanho, PIN). Tarifas ficam em{' '}
          <a href="/tariffs" className="text-primary font-medium">Tarifas por categoria</a>.
        </p>
      </div>

      {settings?.deliveryPricing && (
        <section className="space-y-3">
          <h2 className="font-semibold text-lg">Regras operacionais por veículo</h2>
          <div className="flex flex-wrap gap-4">
            <VehicleOpsCard
              title="Moto"
              vehicleKey="moto"
              pricing={settings.deliveryPricing.moto}
              onChange={patchVehicle}
            />
            <VehicleOpsCard
              title="Carro"
              vehicleKey="car"
              pricing={settings.deliveryPricing.car}
              onChange={patchVehicle}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={saveSettings}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Salvando…' : 'Salvar regras'}
            </button>
            {saveMsg && <p className="text-sm text-text-muted">{saveMsg}</p>}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center gap-3 mb-3">
          <select
            className="border border-border rounded-lg px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button type="button" onClick={load} className="text-sm text-primary font-medium">Atualizar</button>
        </div>

        {loading ? (
          <p className="text-text-muted text-sm">Carregando…</p>
        ) : (
          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-border/40 text-left">
                <tr>
                  <th className="p-3">Status</th>
                  <th className="p-3">Veículo</th>
                  <th className="p-3">Item</th>
                  <th className="p-3">Valor</th>
                  <th className="p-3">Rota</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p._id} className="border-t border-border">
                    <td className="p-3">{STATUS_LABEL[p.status] || p.status}</td>
                    <td className="p-3">{p.vehicleType}</td>
                    <td className="p-3">{p.itemName}</td>
                    <td className="p-3">R$ {Number(p.fare || 0).toFixed(2)}</td>
                    <td className="p-3 max-w-xs truncate" title={`${p.pickup} → ${p.destination}`}>
                      {p.pickup} → {p.destination}
                    </td>
                    <td className="p-3">
                      {!['finished', 'cancelled', 'delivered'].includes(p.status) && (
                        <button type="button" onClick={() => cancel(p._id)} className="text-danger text-xs font-medium">
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-text-muted">Nenhuma encomenda</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
