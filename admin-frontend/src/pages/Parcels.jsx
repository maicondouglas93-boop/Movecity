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
};

export default function Parcels() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [listRes, settingsRes] = await Promise.all([
        api.get('/admin/parcels', { params: status ? { status } : {} }),
        api.get('/admin/parcel-settings'),
      ]);
      setItems(listRes.data.items || []);
      setSettings(settingsRes.data);
    } catch (err) {
      console.error(err);
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

  const saveSettings = async () => {
    await api.put('/admin/parcel-settings', settings);
    alert('Tarifas de encomenda salvas');
    load();
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text">Encomendas</h1>
        <p className="text-sm text-text-muted mt-1">Listagem e tarifas do módulo de entregas</p>
      </div>

      {settings && (
        <section className="bg-surface border border-border rounded-xl p-4 space-y-3 max-w-xl">
          <h2 className="font-semibold">Tarifas & regras</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {['baseFare', 'perKm', 'perMinute', 'minimumFare', 'motoMaxWeightKg'].map((key) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-text-muted">{key}</span>
                <input
                  type="number"
                  className="border border-border rounded-lg px-3 py-2"
                  value={settings[key] ?? ''}
                  onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
                />
              </label>
            ))}
            <label className="flex flex-col gap-1">
              <span className="text-text-muted">motoMaxSize</span>
              <select
                className="border border-border rounded-lg px-3 py-2"
                value={settings.motoMaxSize || 'medium'}
                onChange={(e) => setSettings({ ...settings, motoMaxSize: e.target.value })}
              >
                <option value="small">small</option>
                <option value="medium">medium</option>
                <option value="large">large</option>
              </select>
            </label>
            <label className="flex items-center gap-2 col-span-2">
              <input
                type="checkbox"
                checked={!!settings.requireDeliveryPin}
                onChange={(e) => setSettings({ ...settings, requireDeliveryPin: e.target.checked })}
              />
              Exigir PIN na entrega
            </label>
            <label className="flex items-center gap-2 col-span-2">
              <input
                type="checkbox"
                checked={!!settings.blockIncompatibleMoto}
                onChange={(e) => setSettings({ ...settings, blockIncompatibleMoto: e.target.checked })}
              />
              Bloquear moto incompatível (tamanho/peso)
            </label>
          </div>
          <button type="button" onClick={saveSettings} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium">
            Salvar tarifas
          </button>
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
