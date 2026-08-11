import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { Clock, User } from 'lucide-react';
import { formatDateTime, formatMoney } from '../utils/format';

const FIELD_LABELS = {
  baseFare: 'Bandejada',
  perKm: 'Por km',
  perMinute: 'Por minuto',
  minimumFare: 'Tarifa mínima',
  platformCommission: 'Comissão da plataforma',
  displayName: 'Nome de exibição',
  name: 'Identificador',
  isActive: 'Ativo',
  active: 'Ativo',
  capacity: 'Capacidade',
  sortOrder: 'Ordem',
  pricing: 'Preços',
  parcelAdjustment: 'Ajuste de encomenda',
  surcharges: 'Sobretaxas',
  optionals: 'Opcionais',
  type: 'Tipo',
  value: 'Valor',
  night: 'Noturna',
  waiting: 'Espera',
  extraStops: 'Paradas extras',
  cancellation: 'Cancelamento',
  startTime: 'Horário início',
  endTime: 'Horário fim',
  freeMinutes: 'Minutos livres',
  valuePerMinute: 'Valor por minuto',
  valuePerStop: 'Valor por parada',
};

const MONEY_KEYS = new Set([
  'baseFare',
  'perKm',
  'perMinute',
  'minimumFare',
  'value',
  'valuePerMinute',
  'valuePerStop',
]);

const PERCENT_KEYS = new Set(['platformCommission']);

function labelFor(path) {
  const parts = path.split('.');
  const leaf = parts[parts.length - 1];
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  if (FIELD_LABELS[leaf]) {
    const context = parts
      .slice(0, -1)
      .map((p) => FIELD_LABELS[p] || p)
      .filter((p) => p !== 'Preços' && p !== 'pricing')
      .join(' · ');
    return context ? `${context} · ${FIELD_LABELS[leaf]}` : FIELD_LABELS[leaf];
  }
  return leaf.replace(/([A-Z])/g, ' $1').trim();
}

function formatLeaf(path, val, flatSibling = {}) {
  if (val === undefined || val === null) return '—';
  if (typeof val === 'boolean') return val ? 'Sim' : 'Não';
  if (Array.isArray(val)) {
    if (val.length === 0) return 'Nenhum';
    return val
      .map((item) => (typeof item === 'object' ? (item.name || item.label || JSON.stringify(item)) : String(item)))
      .join(', ');
  }
  if (typeof val === 'object') return null;
  const leaf = path.split('.').pop();
  if (PERCENT_KEYS.has(leaf)) return `${Number(val)}%`;
  if (leaf === 'type') {
    if (val === 'percentage') return 'Porcentagem';
    if (val === 'fixed') return 'Valor fixo';
    if (val === 'multiplier') return 'Multiplicador';
  }
  if (path.includes('parcelAdjustment') && leaf === 'value') {
    const typePath = path.replace(/\.value$/, '.type');
    const type = flatSibling[typePath];
    return type === 'fixed' ? formatMoney(val) : `${Number(val)}%`;
  }
  if (path.includes('surcharges.night') && leaf === 'value') {
    const typePath = path.replace(/\.value$/, '.type');
    const type = flatSibling[typePath];
    return type === 'fixed' ? formatMoney(val) : `× ${Number(val)}`;
  }
  if (MONEY_KEYS.has(leaf) && typeof val === 'number') return formatMoney(val);
  return String(val);
}

/** Achata objetos aninhados em pares path → valor. */
function flatten(obj, prefix = '', out = {}) {
  if (obj === null || obj === undefined) {
    out[prefix || '_'] = obj;
    return out;
  }
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    out[prefix] = obj;
    return out;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    out[prefix] = {};
    return out;
  }
  for (const key of keys) {
    if (key === '_id' || key === 'updatedAt' || key === '__v' || key === 'createdAt') continue;
    const next = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, next, out);
    } else {
      out[next] = value;
    }
  }
  return out;
}

function collectChanges(oldValue, newValue) {
  const oldFlat = flatten(oldValue || {});
  const newFlat = flatten(newValue || {});
  const paths = new Set([...Object.keys(oldFlat), ...Object.keys(newFlat)]);
  const rows = [];
  for (const path of paths) {
    if (path === 'pricing' || path.endsWith('.')) continue;
    const before = oldFlat[path];
    const after = newFlat[path];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const formattedBefore = formatLeaf(path, before, oldFlat);
    const formattedAfter = formatLeaf(path, after, newFlat);
    if (formattedBefore === null || formattedAfter === null) continue;
    rows.push({
      path,
      label: labelFor(path),
      before: formattedBefore,
      after: formattedAfter,
    });
  }
  rows.sort((a, b) => {
    const ap = a.path.startsWith('pricing') ? 0 : 1;
    const bp = b.path.startsWith('pricing') ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.label.localeCompare(b.label, 'pt-BR');
  });
  return rows;
}

function ChangeRow({ label, before, after }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-sm py-1.5 border-b border-border/40 last:border-0">
      <span className="sm:w-48 shrink-0 text-text-muted font-medium">{label}</span>
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span className="line-through text-danger/80">{before}</span>
        <span className="text-text-muted">→</span>
        <span className="text-primary font-semibold">{after}</span>
      </div>
    </div>
  );
}

export default function TariffHistory({ categoryId, categoryName }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ['tariffHistory', categoryId],
    queryFn: async () => {
      const url = categoryId
        ? `/admin/tariffs/history?categoryId=${categoryId}`
        : `/admin/tariffs/history`;
      const { data } = await api.get(url);
      return data;
    },
  });

  if (isLoading) return <div className="text-text-muted text-sm py-4">Carregando histórico...</div>;
  if (!history || history.length === 0) return null;

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden mt-6">
      <div className="bg-background/50 border-b border-border px-4 py-3 flex items-center gap-2">
        <Clock className="w-4 h-4 text-text-muted" />
        <h3 className="font-semibold text-base">
          Últimas alterações{categoryName ? ` · ${categoryName}` : ''}
        </h3>
      </div>

      <div className="divide-y divide-border">
        {history.map((log) => {
          const changes = log.action === 'create' ? [] : collectChanges(log.oldValue, log.newValue);
          return (
            <div key={log._id} className="p-4 flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                {log.action === 'create' ? (
                  <p className="text-sm font-medium text-text">Categoria criada ou duplicada</p>
                ) : changes.length === 0 ? (
                  <p className="text-sm text-text-muted">Sem alterações detalhadas registradas</p>
                ) : (
                  <div>
                    {changes.map((row) => (
                      <ChangeRow key={row.path} label={row.label} before={row.before} after={row.after} />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex md:flex-col items-center md:items-end gap-2 md:gap-1 text-xs text-text-muted md:border-l md:border-border md:pl-4 shrink-0">
                <div className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  <span>{log.admin}</span>
                </div>
                <div>{formatDateTime(log.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
