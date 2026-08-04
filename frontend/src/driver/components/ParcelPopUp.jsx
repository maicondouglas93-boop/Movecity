import React, { useState } from 'react'

const SIZE_LABEL = { small: 'Pequeno', medium: 'Médio', large: 'Grande' }

const ParcelPopUp = ({ parcel, onAccept, onDecline }) => {
  const [busy, setBusy] = useState(false)

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
    <div className="fixed inset-x-0 bottom-0 z-40 bg-surface border-t border-line rounded-t-2xl p-4 shadow-raised max-h-[70dvh] overflow-y-auto">
      <div className="w-10 h-1 bg-line rounded-full mx-auto mb-3" />
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 mb-1">Encomenda</p>
      <h3 className="text-lg font-bold text-ink-900 mb-2">
        {parcel.vehicleType === 'moto' ? 'Moto' : 'Carro'} · R${' '}
        {Number(parcel.fare || 0).toFixed(2).replace('.', ',')}
      </h3>
      <div className="space-y-2 text-sm text-ink-700 mb-4">
        <p><span className="text-ink-400">Retirada:</span> {parcel.pickup}</p>
        <p><span className="text-ink-400">Entrega:</span> {parcel.destination}</p>
        <p><span className="text-ink-400">Item:</span> {parcel.itemName}</p>
        <p><span className="text-ink-400">Peso:</span> {parcel.weightKg} kg · {SIZE_LABEL[parcel.size] || parcel.size}</p>
        {parcel.description && <p><span className="text-ink-400">Descrição:</span> {parcel.description}</p>}
        {parcel.notes && <p><span className="text-ink-400">Obs:</span> {parcel.notes}</p>}
        <p><span className="text-ink-400">Remetente:</span> {parcel.sender?.name}</p>
        <p><span className="text-ink-400">Destinatário:</span> {parcel.recipient?.name}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(onDecline)}
          className="min-h-[48px] rounded-panel border border-line font-semibold text-ink-700 disabled:opacity-50"
        >
          Recusar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(onAccept)}
          className="min-h-[48px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50"
        >
          {busy ? 'Aguarde…' : 'Aceitar'}
        </button>
      </div>
    </div>
  )
}

export default ParcelPopUp
