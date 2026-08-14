// Fase 3 da auditoria de production readiness (M3, 2026-08-05): extraído de
// pages/Rides.jsx (arquivo passava de 780 linhas). Sem mudança de comportamento —
// apenas o vocabulário visual de corrida compartilhado entre lista, drawer e mapa.
//
// Auditoria de UX (2026-08-10): statusColors/statusNames locais não cobriam
// 'scheduled' nem 'waiting_passenger' (2 dos 9 valores do enum de corrida) — nesses
// casos a badge caía no fallback cinza com o texto técnico cru. Promovidos pro
// dicionário compartilhado (utils/statusDictionary.js), que também cobre encomenda —
// necessário agora que /rides lista os dois tipos juntos.
import { RIDE_STATUS_LABELS, RIDE_STATUS_COLORS, PARCEL_STATUS_LABELS, PARCEL_STATUS_COLORS, statusLabel, statusColor } from '../../utils/statusDictionary';

export function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " anos atrás";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " meses atrás";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " dias atrás";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " horas atrás";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " min atrás";
  return "Agora mesmo";
}

// item = corrida OU encomenda (unificados na mesma lista) — usa o dicionário certo
// conforme item.serviceType.
export function itemStatusLabel(item) {
  return item?.serviceType === 'parcel'
    ? statusLabel(PARCEL_STATUS_LABELS, item.status)
    : statusLabel(RIDE_STATUS_LABELS, item?.status);
}

export function itemStatusColor(item) {
  return item?.serviceType === 'parcel'
    ? statusColor(PARCEL_STATUS_COLORS, item.status)
    : statusColor(RIDE_STATUS_COLORS, item?.status);
}

/** Endereço/coordenadas da etapa atual (retirada vs. destino), pra abrir no Google Maps. */
const RIDE_PICKUP_LEG_STATUSES = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'];
const PARCEL_PICKUP_LEG_STATUSES = ['provider_accepted', 'going_to_pickup', 'arrived_pickup'];

export function currentLegTarget(item) {
  if (!item) return null;
  const pickupLeg = item.serviceType === 'parcel'
    ? PARCEL_PICKUP_LEG_STATUSES.includes(item.status)
    : RIDE_PICKUP_LEG_STATUSES.includes(item.status);
  const coords = pickupLeg ? item.pickupCoordinates : item.destinationCoordinates;
  const address = pickupLeg ? item.pickup : item.destination;
  return { pickupLeg, address, lat: coords?.lat, lng: coords?.lng };
}

export function googleMapsUrl(target) {
  if (!target) return null;
  const destination = Number.isFinite(target.lat) && Number.isFinite(target.lng)
    ? `${target.lat},${target.lng}`
    : target.address;
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

/** Rótulo humano das ações de admin.service.js/logAction pra corrida (bloco Auditoria do drawer). */
export const RIDE_LOG_ACTION_LABELS = {
  cancel_ride: 'Corrida cancelada pelo admin',
  reassign_ride: 'Corrida reatribuída (voltou à fila)',
  relaunch_manual_ride: 'Corrida lançada novamente',
  bulk_cancel_rides: 'Cancelamento em lote',
  admin_finalize_ride: 'Corrida finalizada manualmente',
};

export function canRelaunchManualRide(ride, now = Date.now()) {
  if (!ride || ride.serviceType === 'parcel') return false;
  if (ride.source !== 'admin' || ride.status !== 'requested' || ride.captain) return false;
  const expiresAt = ride.offerExpiresAt ? new Date(ride.offerExpiresAt).getTime() : NaN;
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

/** Motivos aceitos por PUT /admin/rides/:id/finalize (espelha o backend). */
export const FINALIZE_REASONS = [
  'Solicitação do passageiro',
  'Problema técnico',
  'Motorista não conseguiu finalizar pelo aplicativo',
  'GPS/localização inconsistente',
  'Encerramento operacional',
  'Outro',
];

/** Corridas iniciadas (ou finished sem pagamento) com motorista — elegíveis à finalização ADM.
 *  Encomenda nunca é elegível: PUT /admin/rides/:id/finalize só existe pra corrida
 *  (auditoria de UX, 2026-08-10 — /rides agora lista os dois tipos juntos). */
export function canFinalizeRide(ride) {
  if (!ride) return false;
  if (ride.serviceType === 'parcel') return false;
  if (ride.paymentStatus === 'paid') return false;
  if (!['started', 'finished'].includes(ride.status)) return false;
  if (!ride.captain) return false;
  return true;
}
