// Padronização de moeda (auditoria de UX, 2026-08-10) — antes coexistiam 3 formatações
// diferentes (toLocaleString com estilo currency, "R$ " + toFixed(2) com ponto decimal,
// valor cru sem "R$"), nenhuma delas com o sinal +/- pedido para deixar claro se um
// valor entrou ou saiu. Toda tela de dinheiro do painel deve usar esta função.
export function formatMoney(value, { showSign = false } = {}) {
  const n = Number(value) || 0;
  const formatted = Math.abs(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (!showSign || n === 0) return formatted;
  return n > 0 ? `+ ${formatted}` : `- ${formatted}`;
}

export function formatPercent(value, { showSign = true, digits = 1 } = {}) {
  const n = Number(value) || 0;
  const formatted = `${Math.abs(n).toFixed(digits)}%`;
  if (!showSign) return formatted;
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return formatted;
}

export function formatDate(date, opts) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('pt-BR', opts || { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Segundos -> "2m 15s" / "45s" / "1h 03m". Usado pelo SLA real de /reports.
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '—';
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}
