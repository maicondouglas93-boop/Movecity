import React from 'react';
import { X, Activity, User, Car, CreditCard, Flag, Shield } from 'lucide-react';
import { timeAgo, statusColors, statusNames, canFinalizeRide } from './rideUi';

// Fase 3 da auditoria de production readiness (M3, 2026-08-05): extraído de
// pages/Rides.jsx sem mudança de comportamento.
export default function RideDrawer({ ride, onClose, onAction }) {
  if (!ride) return null;

  const af = ride.adminFinalization;

  // Fake timeline events for visual demo
  const events = [
    { label: 'Solicitada', time: new Date(ride.createdAt), done: true },
    { label: 'Motorista Aceitou', time: new Date(new Date(ride.createdAt).getTime() + 120000), done: ['accepted', 'going_to_pickup', 'arrived', 'started', 'finished'].includes(ride.status) },
    { label: 'Chegou no local', time: new Date(new Date(ride.createdAt).getTime() + 300000), done: ['arrived', 'started', 'finished'].includes(ride.status) },
    { label: 'Iniciada', time: new Date(new Date(ride.createdAt).getTime() + 360000), done: ['started', 'finished'].includes(ride.status) },
    { label: 'Finalizada', time: new Date(new Date(ride.createdAt).getTime() + 1200000), done: ride.status === 'finished' },
  ];

  if (ride.status === 'cancelled') {
    events.push({ label: 'Cancelada', time: new Date(ride.updatedAt), done: true, isCancel: true });
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[2000] transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[450px] bg-surface border-l border-border shadow-2xl z-[2001] flex flex-col transform transition-transform duration-300 translate-x-0">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-background/50">
          <div>
            <h2 className="text-lg font-bold">Ficha da Corrida</h2>
            <p className="text-xs text-text-muted">ID: {ride._id}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-background rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Status Alert */}
          <div className={`p-4 border rounded-xl flex items-start gap-3 ${statusColors[ride.status] || 'border-border bg-background'}`}>
            <Activity className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm uppercase">{statusNames[ride.status] || ride.status}</p>
              <p className="text-xs mt-1 opacity-80">Atualizado {timeAgo(ride.updatedAt)}</p>
              {ride.status === 'cancelled' && ride.observation && (
                <div className="mt-2 p-2 bg-black/20 rounded border border-white/10 text-xs">
                  <strong>Motivo:</strong> {ride.observation}
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions (Inside Drawer) */}
          {(canFinalizeRide(ride) || !['cancelled', 'finished'].includes(ride.status)) && (
            <div className="flex flex-wrap gap-2">
               {canFinalizeRide(ride) && (
                 <button
                   onClick={() => { onClose(); onAction(ride, 'finalize'); }}
                   className="flex-1 min-w-[140px] py-2 bg-primary/10 text-primary text-sm font-medium rounded-lg border border-primary/20 hover:bg-primary/20 transition-colors inline-flex items-center justify-center gap-1.5"
                 >
                    <Flag className="w-4 h-4" /> Finalizar manualmente
                 </button>
               )}
               {!['cancelled', 'finished'].includes(ride.status) && (
                 <button onClick={() => { onClose(); onAction(ride, 'cancel'); }} className="flex-1 min-w-[120px] py-2 bg-danger/10 text-danger text-sm font-medium rounded-lg border border-danger/20 hover:bg-danger/20 transition-colors">
                    Cancelar Corrida
                 </button>
               )}
               {ride.status === 'requested' && (
                 <button onClick={() => { onClose(); onAction(ride, 'reassign'); }} className="flex-1 min-w-[120px] py-2 bg-warning/10 text-warning text-sm font-medium rounded-lg border border-warning/20 hover:bg-warning/20 transition-colors">
                    Reatribuir
                 </button>
               )}
            </div>
          )}

          {af && (
            <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <Shield className="w-4 h-4" />
                <h3 className="text-sm font-semibold uppercase tracking-wider">Finalização administrativa</h3>
              </div>
              <div className="grid grid-cols-1 gap-1.5 text-sm">
                <p><span className="text-text-muted">Admin:</span> {af.adminName || '—'}</p>
                <p><span className="text-text-muted">Quando:</span> {af.finalizedAt ? new Date(af.finalizedAt).toLocaleString() : '—'}</p>
                <p><span className="text-text-muted">Motivo:</span> {af.reason || '—'}</p>
                {af.observation ? (
                  <p><span className="text-text-muted">Observação:</span> {af.observation}</p>
                ) : null}
                {Number.isFinite(Number(af.finalPrice)) && (
                  <p><span className="text-text-muted">Valor final:</span> R$ {Number(af.finalPrice).toFixed(2)}</p>
                )}
                {Number.isFinite(Number(af.finishLocation?.lat)) && Number.isFinite(Number(af.finishLocation?.lng)) && (
                  <p className="text-xs text-text-muted">
                    GPS: {Number(af.finishLocation.lat).toFixed(5)}, {Number(af.finishLocation.lng).toFixed(5)}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Route Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Trajeto</h3>
            <div className="relative pl-6 space-y-4">
              <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border"></div>
              
              <div className="relative">
                <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-primary ring-4 ring-background"></div>
                <p className="text-sm font-medium">{ride.pickup}</p>
                <p className="text-xs text-text-muted">Origem</p>
              </div>
              
              <div className="relative">
                <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-indigo-500 ring-4 ring-background"></div>
                <p className="text-sm font-medium">{ride.destination}</p>
                <p className="text-xs text-text-muted">Destino</p>
              </div>
            </div>
          </div>

          {/* People */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-background p-3 rounded-xl border border-border">
              <p className="text-xs text-text-muted mb-2 uppercase font-semibold">Passageiro</p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center"><User className="w-4 h-4 text-text-muted" /></div>
                <div className="overflow-hidden">
                  <p className="text-sm font-medium truncate">{ride.user?.fullname?.firstname} {ride.user?.fullname?.lastname}</p>
                  <p className="text-xs text-text-muted truncate">{ride.user?.phone}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-background p-3 rounded-xl border border-border">
              <p className="text-xs text-text-muted mb-2 uppercase font-semibold">Motorista</p>
              {ride.captain ? (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center"><Car className="w-4 h-4 text-text-muted" /></div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium truncate">{ride.captain?.fullname?.firstname}</p>
                    <p className="text-xs text-text-muted truncate">{ride.captain?.vehicle?.plate}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-muted italic py-1">Nenhum atribuído</p>
              )}
            </div>
          </div>

          {/* Payment */}
          <div className="space-y-2 bg-background p-4 rounded-xl border border-border">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Financeiro</h3>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">{ride.status === 'finished' ? 'Valor Final' : 'Valor da Corrida (estimativa)'}</span>
              <span className="font-medium text-text">R$ {(ride.finalPrice ?? ride.fare)?.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Comissão Plataforma</span>
              <span className="font-medium text-primary">R$ {ride.commissionAmount?.toFixed(2) || '-'}</span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-text-muted">Método</span>
              <span className="font-medium text-text uppercase flex items-center gap-1">
                <CreditCard className="w-4 h-4" /> {ride.paymentMethod}
              </span>
            </div>
          </div>

          {/* Timeline (Simulated for visual) */}
          <div className="space-y-4 pt-4 border-t border-border">
             <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">Timeline (Eventos)</h3>
             <div className="space-y-4">
                {events.map((evt, idx) => {
                   if(!evt.done && evt.label !== 'Cancelada' && ride.status === 'cancelled') return null; // Skip pending events if cancelled
                   return (
                     <div key={idx} className={`flex gap-3 ${evt.done ? 'opacity-100' : 'opacity-40'}`}>
                        <div className="flex flex-col items-center">
                           <div className={`w-3 h-3 rounded-full mt-1 ${evt.isCancel ? 'bg-danger' : evt.done ? 'bg-primary' : 'bg-border'}`}></div>
                           {idx < events.length - 1 && <div className={`w-0.5 h-full my-1 ${evt.done ? 'bg-primary/50' : 'bg-border'}`}></div>}
                        </div>
                        <div className="pb-4">
                           <p className={`text-sm font-medium ${evt.isCancel ? 'text-danger' : 'text-text'}`}>{evt.label}</p>
                           {evt.done && <p className="text-xs text-text-muted">{evt.time.toLocaleTimeString()}</p>}
                        </div>
                     </div>
                   )
                })}
             </div>
          </div>

        </div>
      </div>
    </>
  );
}
