import React, { useState } from 'react'

const SIZE_LABEL = { small: 'Pequeno', medium: 'Médio', large: 'Grande' }

const ParcelPopUp = ({ parcel, onAccept, onDecline }) => {
  const [busy, setBusy] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  if (!parcel) return null

  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-surface border-t border-line rounded-t-3xl px-3.5 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-floating max-h-[35dvh] overflow-y-auto overscroll-y-contain">
      <div className="w-10 h-1 bg-line rounded-full mx-auto mb-2" />
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-600">Encomenda</p>
          <h3 className="text-base font-bold text-ink-900 truncate">
            {parcel.vehicleType === 'moto' ? 'Moto' : 'Carro'} · {parcel.itemName}
          </h3>
        </div>
        <p className="text-base font-bold text-ink-900 flex-shrink-0">
          R$ {Number(parcel.fare || 0).toFixed(2).replace('.', ',')}
        </p>
      </div>

      <div className="space-y-1 text-xs text-ink-700 mb-2">
        <p className="flex items-center gap-1.5 min-w-0">
          <i className="ri-map-pin-user-fill text-brand-500 flex-shrink-0" aria-hidden="true" />
          <span className="truncate">{parcel.pickup?.split(',')[0]}</span>
        </p>
        <p className="flex items-center gap-1.5 min-w-0">
          <i className="ri-map-pin-2-fill text-danger-500 flex-shrink-0" aria-hidden="true" />
          <span className="truncate">{parcel.destination?.split(',')[0]}</span>
        </p>
        <p className="text-[11px] text-ink-500">
          {parcel.weightKg} kg · {SIZE_LABEL[parcel.size] || parcel.size}
          {parcel.recipient?.name ? ` · ${parcel.recipient.name}` : ''}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        className="w-full flex items-center justify-center gap-1 text-[11px] font-medium text-ink-400 py-1 mb-1"
        aria-expanded={detailsOpen}
      >
        {detailsOpen ? 'Ocultar detalhes' : 'Ver detalhes'}
        <i className={`ri-arrow-${detailsOpen ? 'up' : 'down'}-s-line`} aria-hidden="true" />
      </button>

      {detailsOpen && (
        <div className="space-y-1 text-xs text-ink-600 mb-2 px-0.5">
          {parcel.description && <p><span className="text-ink-400">Descrição:</span> {parcel.description}</p>}
          {parcel.notes && <p><span className="text-ink-400">Obs:</span> {parcel.notes}</p>}
          {parcel.sender?.name && <p><span className="text-ink-400">Remetente:</span> {parcel.sender.name}</p>}
          {parcel.recipient?.name && <p><span className="text-ink-400">Destinatário:</span> {parcel.recipient.name}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(onDecline)}
          className="min-h-[44px] rounded-panel border border-line font-semibold text-ink-700 text-sm disabled:opacity-50"
        >
          Recusar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(onAccept)}
          className="min-h-[44px] rounded-panel bg-brand-500 text-white font-semibold text-sm disabled:opacity-50"
        >
          {busy ? 'Aguarde…' : 'Aceitar'}
        </button>
      </div>
    </div>
  )
}

export default ParcelPopUp
