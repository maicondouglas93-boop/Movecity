import React, { useState } from 'react';
import { X } from 'lucide-react';
import { FINALIZE_REASONS } from './rideUi';

export default function FinalizeRideModal({ ride, onClose, onConfirm, saving }) {
  const [reason, setReason] = useState(FINALIZE_REASONS[0]);
  const [observation, setObservation] = useState('');

  if (!ride) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!reason) return;
    onConfirm({ reason, observation: observation.trim() });
  };

  return (
    <div
      className="fixed inset-0 z-[3500] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-surface rounded-xl border border-border w-full max-w-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg text-text">Finalizar corrida</h2>
            <p className="text-xs text-text-muted mt-0.5">ID: {ride._id}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-background rounded-full text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-sm text-text-muted">
            Encerra a corrida com a mesma lógica financeira do app do motorista e registra auditoria administrativa.
            Exige GPS válido do motorista.
          </p>

          <div>
            <label htmlFor="finalize-reason" className="block text-sm font-medium text-text-muted mb-1">
              Motivo
            </label>
            <select
              id="finalize-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-primary outline-none"
            >
              {FINALIZE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="finalize-observation" className="block text-sm font-medium text-text-muted mb-1">
              Observação <span className="font-normal">(opcional)</span>
            </label>
            <textarea
              id="finalize-observation"
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              rows={3}
              placeholder="Detalhes adicionais para auditoria…"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-primary outline-none resize-none"
            />
          </div>

          <div className="pt-2 flex justify-end gap-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-text-muted hover:text-text font-medium text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !reason}
              className="px-4 py-2 rounded-lg font-medium text-sm text-white bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Finalizando…' : 'Confirmar finalização'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
