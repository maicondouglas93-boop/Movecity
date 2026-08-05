// Fase 3 da auditoria de production readiness (M3, 2026-08-05): extraído de
// pages/Rides.jsx (arquivo passava de 780 linhas). Sem mudança de comportamento —
// apenas o vocabulário visual de corrida compartilhado entre lista, drawer e mapa.

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

export const statusColors = {
  requested: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  accepted: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  going_to_pickup: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  arrived: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  started: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  finished: 'bg-green-500/10 text-green-500 border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-500 border-red-500/20',
};

export const statusNames = {
  requested: 'Procurando',
  accepted: 'Aceita',
  going_to_pickup: 'A caminho',
  arrived: 'Motorista Chegou',
  started: 'Em andamento',
  finished: 'Finalizada',
  cancelled: 'Cancelada',
};
