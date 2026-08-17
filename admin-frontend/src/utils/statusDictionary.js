// Dicionários únicos de status/tipo (auditoria de UX, 2026-08-10) — antes cada tela
// (Rides, Captains, Finance) tinha sua própria tradução parcial, e a de Captains
// (feita só pra approvalStatus) era reaproveitada em corridas por engano, caindo
// sempre no texto técnico cru. Valores dos enums conferidos direto nos models do
// Backend — nenhum nome aqui foi inventado.

// ride.model.js:53
export const RIDE_STATUS_LABELS = {
  scheduled: 'Agendada',
  requested: 'Aguardando motorista',
  accepted: 'Motorista a caminho',
  going_to_pickup: 'Motorista a caminho',
  arrived: 'Motorista chegou',
  waiting_passenger: 'Aguardando passageiro',
  started: 'Em viagem',
  finished: 'Concluída',
  cancelled: 'Cancelada',
};

export const RIDE_STATUS_COLORS = {
  scheduled: 'bg-info/10 text-info border-info/20',
  requested: 'bg-warning/10 text-warning border-warning/20',
  accepted: 'bg-info/10 text-info border-info/20',
  going_to_pickup: 'bg-info/10 text-info border-info/20',
  arrived: 'bg-info/10 text-info border-info/20',
  waiting_passenger: 'bg-warning/10 text-warning border-warning/20',
  started: 'bg-info/10 text-info border-info/20',
  finished: 'bg-primary/10 text-primary border-primary/20',
  cancelled: 'bg-danger/10 text-danger border-danger/20',
};

// Status considerados "em andamento" para cards/filtros de operação — mesmo
// agrupamento de Backend/services/admin.service.js:ONGOING_RIDE_STATUSES. Mudou lá,
// muda aqui também (não há pacote compartilhado entre front/back neste repo).
export const ONGOING_RIDE_STATUSES = ['accepted', 'going_to_pickup', 'arrived', 'started', 'waiting_passenger'];

// parcel.model.js:89-104
export const PARCEL_STATUS_LABELS = {
  scheduled: 'Agendada',
  awaiting_provider: 'Aguardando motorista',
  provider_accepted: 'Motorista a caminho',
  going_to_pickup: 'Motorista a caminho',
  arrived_pickup: 'Motorista na retirada',
  collected: 'Objeto coletado',
  in_transit: 'A caminho do destino',
  arrived_destination: 'Motorista no destino',
  delivered: 'Entregue',
  finished: 'Concluída',
  cancelled: 'Cancelada',
};

export const PARCEL_STATUS_COLORS = {
  scheduled: 'bg-info/10 text-info border-info/20',
  awaiting_provider: 'bg-warning/10 text-warning border-warning/20',
  provider_accepted: 'bg-info/10 text-info border-info/20',
  going_to_pickup: 'bg-info/10 text-info border-info/20',
  arrived_pickup: 'bg-info/10 text-info border-info/20',
  collected: 'bg-info/10 text-info border-info/20',
  in_transit: 'bg-info/10 text-info border-info/20',
  arrived_destination: 'bg-info/10 text-info border-info/20',
  delivered: 'bg-primary/10 text-primary border-primary/20',
  finished: 'bg-primary/10 text-primary border-primary/20',
  cancelled: 'bg-danger/10 text-danger border-danger/20',
};

export const ONGOING_PARCEL_STATUSES = ['provider_accepted', 'going_to_pickup', 'arrived_pickup', 'collected', 'in_transit', 'arrived_destination'];

// captain.model.js:67 — status DA CONTA (aprovação/cadastro). Não confundir com
// status OPERACIONAL (isOnline/isAvailable), que não usa este dicionário.
export const CAPTAIN_APPROVAL_LABELS = {
  iniciado: 'Cadastro iniciado',
  documentos_enviados: 'Docs enviados',
  em_analise: 'Em análise',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
  suspenso: 'Suspenso',
  bloqueado: 'Bloqueado',
  expirado: 'Prazo expirado',
};

export const CAPTAIN_APPROVAL_COLORS = {
  iniciado: 'bg-border text-text',
  documentos_enviados: 'bg-info/10 text-info border-info/20',
  em_analise: 'bg-warning/10 text-warning border-warning/20',
  aprovado: 'bg-primary/10 text-primary border-primary/20',
  reprovado: 'bg-danger/10 text-danger border-danger/20',
  suspenso: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  bloqueado: 'bg-danger/10 text-danger border-danger/20',
  expirado: 'bg-danger/10 text-danger border-danger/20',
};

// ride.model.js:239 (paymentStatus)
export const PAYMENT_STATUS_LABELS = {
  pending: 'Pagamento pendente',
  paid: 'Pago',
  failed: 'Falhou',
  refunded: 'Estornado',
};

export const PAYMENT_STATUS_COLORS = {
  pending: 'bg-warning/10 text-warning border-warning/20',
  paid: 'bg-primary/10 text-primary border-primary/20',
  failed: 'bg-danger/10 text-danger border-danger/20',
  refunded: 'bg-info/10 text-info border-info/20',
};

// ride.model.js:244 / transaction.model.js:24
export const PAYMENT_METHOD_LABELS = {
  card: 'Cartão',
  cash: 'Dinheiro',
  pix: 'Pix',
  carteira: 'Carteira MoveCity',
  wallet: 'Carteira MoveCity',
};

// transaction.model.js:20 — tipo de movimentação financeira
export const TRANSACTION_TYPE_LABELS = {
  commission: 'Comissão',
  recharge: 'Recarga',
  withdraw: 'Saque',
  payout: 'Repasse',
  bonus: 'Bônus',
  adjustment: 'Ajuste manual',
  ride_payment: 'Pagamento de corrida',
  parcel_payment: 'Pagamento de encomenda',
  wallet_contribution: 'Carteira do passageiro',
};

// payout.model.js:15
export const PAYOUT_STATUS_LABELS = {
  requested: 'Solicitado',
  in_analysis: 'Em análise',
  approved: 'Aprovado',
  processing: 'Processando',
  paid: 'Pago',
  rejected: 'Rejeitado',
};

export const PAYOUT_STATUS_COLORS = {
  requested: 'bg-info/10 text-info border-info/20',
  in_analysis: 'bg-warning/10 text-warning border-warning/20',
  approved: 'bg-primary/10 text-primary border-primary/20',
  processing: 'bg-info/10 text-info border-info/20',
  paid: 'bg-primary/10 text-primary border-primary/20',
  rejected: 'bg-danger/10 text-danger border-danger/20',
};

const FALLBACK_COLOR = 'bg-background text-text-muted border-border';

export function statusLabel(dict, value) {
  return dict[value] || value || '—';
}

export function statusColor(dict, value) {
  return dict[value] || FALLBACK_COLOR;
}
