// Plano de correção (Fase 3.1, 2026-08-16): compartilhado entre payout.model.js (índice
// único parcial) e wallet.service.js (pré-checagem) pra não divergir sobre o que conta
// como "saque ativo" — mesmo padrão de config/rideCreationPolicy.js.
const ACTIVE_PAYOUT_STATUSES = Object.freeze([
    'requested',
    'in_analysis',
    'approved',
    'processing',
]);

module.exports = {
    ACTIVE_PAYOUT_STATUSES,
};
