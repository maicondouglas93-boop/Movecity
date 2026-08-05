import React, { useState, useEffect, memo } from 'react';
import {
  Search, MoreVertical, CreditCard, User, Car, CheckSquare, Square, RotateCcw, ShieldAlert,
} from 'lucide-react';
import { timeAgo, statusColors, statusNames } from './rideUi';

// Fase 3 da auditoria de production readiness (M3, 2026-08-05): extraído de
// pages/Rides.jsx sem mudança de comportamento.
//
// Bloco J (2026-08-02, achado R33): mesmo raciocínio de CaptainRow em Captains.jsx —
// cada ping de GPS recriava liveDrivers e re-renderizava a tabela inteira, mesmo essa
// linha não exibindo nenhum dado de liveDrivers diretamente. React.memo evita refazer
// o trabalho de render de todas as linhas não afetadas.
const RideRow = memo(function RideRow({ ride, isSelected, onToggleSelect, onOpenDrawer, onAction }) {
  return (
    <tr onClick={() => onOpenDrawer(ride)} className={`cursor-pointer hover:bg-surface/50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}>
      <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onToggleSelect(ride._id)}>
          {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-text-muted" />}
        </button>
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-background border border-border flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-text-muted" />
          </div>
          <div>
            <p className="font-medium">{ride.user?.fullname?.firstname || 'Passageiro'}</p>
            <p className="text-xs text-text-muted">{ride.captain?.fullname?.firstname ? `Motorista: ${ride.captain.fullname.firstname}` : 'Buscando motorista...'}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-background rounded border border-border capitalize">
            <Car className="w-3 h-3 text-text-muted" /> {ride.vehicleType}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-text-muted capitalize">
            <CreditCard className="w-3 h-3" /> {ride.paymentMethod}
          </span>
        </div>
      </td>
      <td className="px-4 py-4">
        <p className="font-medium text-text">R$ {ride.fare?.toFixed(2)}</p>
        <p className="text-xs text-text-muted">Comis: R$ {ride.commissionAmount ? ride.commissionAmount.toFixed(2) : '-'}</p>
      </td>
      <td className="px-4 py-4">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusColors[ride.status] || 'bg-background'}`}>
          {statusNames[ride.status] || ride.status}
        </span>
      </td>
      <td className="px-4 py-4 text-xs">
        <p className="text-text">{new Date(ride.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        <p className="text-text-muted">{timeAgo(ride.createdAt)}</p>
      </td>
      <td className="px-4 py-4 text-right" onClick={(e) => e.stopPropagation()}>
        <RideActionMenu ride={ride} onAction={onAction} />
      </td>
    </tr>
  );
});

function RideActionMenu({ ride, onAction }) {
  const [open, setOpen] = useState(false);

  // Fecha clicando fora
  useEffect(() => {
    const handleClick = () => setOpen(false);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
      <button 
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-md hover:bg-background border border-transparent hover:border-border transition-colors text-text-muted"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      
      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-surface border border-border rounded-lg shadow-xl z-50 py-1">
          <button onClick={() => onAction(ride, 'view')} className="w-full text-left px-4 py-2 text-sm hover:bg-background flex items-center gap-2">
            <Search className="w-4 h-4" /> Ver Ficha Completa
          </button>
          
          {ride.status === 'requested' && (
            <>
              <button onClick={() => onAction(ride, 'reassign')} className="w-full text-left px-4 py-2 text-sm hover:bg-background flex items-center gap-2 text-warning">
                <RotateCcw className="w-4 h-4" /> Reatribuir
              </button>
            </>
          )}

          {!['cancelled', 'finished'].includes(ride.status) && (
            <button onClick={() => onAction(ride, 'cancel')} className="w-full text-left px-4 py-2 text-sm hover:bg-danger/10 flex items-center gap-2 text-danger">
              <ShieldAlert className="w-4 h-4" /> Cancelar Operação
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default RideRow;
