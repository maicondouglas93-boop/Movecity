import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, ArrowUpRight } from 'lucide-react';
import api from '../services/api';

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

// Auditoria de UX (2026-08-10, 2ª rodada — telas fora do escopo original) — esta tela
// misturava duas coisas sem relação: regras operacionais (config global, o que
// continua aqui) e uma listagem de encomendas individuais com cancelamento (removida).
// A listagem tinha problemas reais que o /rides unificado (auditoria da 1ª rodada) já
// resolve melhor: usava window.confirm() nativo em vez do useConfirm() do app, o
// motivo do cancelamento era sempre a mesma string fixa "Cancelado pelo admin" (nunca
// perguntava o motivo real — pior rastro de auditoria que o de corrida), sem paginação
// visível (só os 50 primeiros registros, sem indicação de que havia mais) e sem
// nenhum detalhe do cliente/motorista. Manter as duas versões divergentes da mesma
// função — uma completa em /rides, outra rudimentar aqui — só criaria confusão sobre
// qual usar. /rides?type=parcel já cobre isso com drawer completo, motivo real de
// cancelamento e paginação.
export default function Parcels() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/parcel-settings');
      setSettings(normalizeSettings(data));
    } catch (err) {
      console.error(err);
      setSaveMsg(err.response?.data?.message || 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    <div className="p-6 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-text">Encomendas — Regras Operacionais</h1>
        <p className="text-sm text-text-muted mt-1">
          Peso, tamanho e exigência de PIN por categoria de veículo. Tarifas ficam em{' '}
          <Link to="/tariffs" className="text-primary font-medium hover:underline">Tarifas por categoria</Link>.
        </p>
      </div>

      <Link
        to="/rides?type=parcel"
        className="flex items-center justify-between gap-3 p-4 bg-surface border border-border rounded-xl hover:border-primary/50 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
            <Package className="w-5 h-5 text-purple-500" />
          </div>
          <div>
            <p className="font-medium text-text">Ver e gerenciar encomendas individuais</p>
            <p className="text-xs text-text-muted mt-0.5">Listagem completa, filtros, cancelamento e histórico ficam em Corridas — filtro "Só encomendas".</p>
          </div>
        </div>
        <ArrowUpRight className="w-5 h-5 text-text-muted group-hover:text-primary transition-colors" />
      </Link>

      {loading ? (
        <p className="text-text-muted text-sm">Carregando…</p>
      ) : settings?.deliveryPricing && (
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
    </div>
  );
}
