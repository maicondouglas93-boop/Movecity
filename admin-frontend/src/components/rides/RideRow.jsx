import React, { useState, useEffect, memo } from 'react';
import {
  Search, MoreVertical, CreditCard, User, Car, Package, CheckSquare, Square, RotateCcw, ShieldAlert, Flag,
} from 'lucide-react';
import { timeAgo, itemStatusLabel, itemStatusColor, canFinalizeRide } from './rideUi';
import StatusBadge from '../StatusBadge';
import { formatMoney } from '../../utils/format';
import { PAYMENT_METHOD_LABELS } from '../../utils/statusDictionary';

// Fase 3 da auditoria de production readiness (M3, 2026-08-05): extraído de
// pages/Rides.jsx sem mudança de comportamento.
//
// Bloco J (2026-08-02, achado R33): mesmo raciocínio de CaptainRow em Captains.jsx —
// cada ping de GPS recriava liveDrivers e re-renderizava a tabela inteira, mesmo essa
// linha não exibindo nenhum dado de liveDrivers diretamente. React.memo evita refazer
// o trabalho de render de todas as linhas não afetadas.
const RideRow = memo(function RideRow({ ride, isSelected, onToggleSelect, onOpenDrawer, onAction }) {
  const isParcel = ride.serviceType === 'parcel';
  return (
    <tr onClick={() => onOpenDrawer(ride)} className={`cursor-pointer hover:bg-surface/50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}>
      <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
        {/* Ações em lote hoje só cobrem corrida (bulkActionRides) — encomenda tem
            cancelamento próprio em /admin/parcels/:id/cancel, ainda não tem endpoint de
            lote; por isso a linha de encomenda não entra na seleção múltipla. */}
        {isParcel ? (
          <span title="Seleção em lote disponível só para corridas" className="inline-block w-4 h-4" />
        ) : (
          <button onClick={() => onToggleSelect(ride._id)}>
            {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-text-muted" />}
          </button>
        )}
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-background border border-border flex items-center justify-center shrink-0" title={isParcel ? 'Encomenda' : 'Corrida'}>
            {isParcel ? <Package className="w-4 h-4 text-purple-500" /> : <User className="w-4 h-4 text-text-muted" />}
          </div>
          <div>
            <p className="font-medium">{ride.user?.fullname?.firstname || ride.adminPassenger?.name || (isParcel ? 'Remetente' : 'Passageiro')}</p>
            <p className="text-xs text-text-muted">{ride.captain?.fullname?.firstname ? `Motorista: ${ride.captain.fullname.firstname}` : 'Buscando motorista...'}</p>
            {ride.source === 'admin' && <p className="text-[10px] font-semibold text-primary uppercase">Criada pelo ADM{ride.createdBy?.name ? ` · ${ride.createdBy.name}` : ''}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-background rounded border border-border capitalize">
            <Car className="w-3 h-3 text-text-muted" /> {ride.vehicleType}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-text-muted">
            <CreditCard className="w-3 h-3" /> {PAYMENT_METHOD_LABELS[ride.paymentMethod] || ride.paymentMethod}
          </span>
        </div>
      </td>
      <td className="px-4 py-4">
        <p className="font-medium text-text">{formatMoney(ride.finalPrice ?? ride.fare)}</p>
        {Number.isFinite(ride.finalPrice) && ride.finalPrice !== ride.fare && (
          <p className="text-xs text-text-muted">Estimativa: {formatMoney(ride.fare)}</p>
        )}
        <p className="text-xs text-text-muted">Comis: {ride.commissionAmount ? formatMoney(ride.commissionAmount) : '-'}</p>
      </td>
      <td className="px-4 py-4">
        <StatusBadge colorClass={itemStatusColor(ride)} label={itemStatusLabel(ride)} className="normal-case" />
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
          
          {ride.status === 'requested' && ride.serviceType !== 'parcel' && (
            <button onClick={() => onAction(ride, 'reassign')} className="w-full text-left px-4 py-2 text-sm hover:bg-background flex items-center gap-2 text-warning">
              <RotateCcw className="w-4 h-4" /> Reatribuir
            </button>
          )}

          {canFinalizeRide(ride) && (
            <button onClick={() => onAction(ride, 'finalize')} className="w-full text-left px-4 py-2 text-sm hover:bg-primary/10 flex items-center gap-2 text-primary">
              <Flag className="w-4 h-4" /> Finalizar manualmente
            </button>
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
