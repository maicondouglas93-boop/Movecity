import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import PageHeader from '@/shared/components/ui/PageHeader'
import EmptyState from '@/shared/components/ui/EmptyState'
import { getAccessToken } from '@/shared/services/session'

const formatWhen = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const CaptainScheduled = () => {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await axios.get(
          `${import.meta.env.VITE_BASE_URL}/captains/scheduled-upcoming`,
          { headers: { Authorization: `Bearer ${getAccessToken('captain')}` } },
        )
        if (alive) setItems(data.upcoming || [])
      } catch {
        if (alive) setError(true)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <div className="min-h-screen bg-surface-alt flex flex-col">
      <PageHeader title="Serviços agendados" onBack={() => navigate('/captain-home')} />
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        <p className="text-sm text-ink-500">
          Prévia das próximas 24 horas perto de você. Esta lista é só informativa —
          o aceite acontece quando a oferta real aparecer no app.
        </p>
        {loading ? (
          <div className="flex justify-center py-10">
            <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true" />
          </div>
        ) : error ? (
          <EmptyState
            variant="error"
            icon="ri-error-warning-line"
            title="Não foi possível carregar"
            description="Tente novamente em instantes."
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="ri-calendar-todo-line"
            title="Nada agendado por perto"
            description="Quando houver corridas ou encomendas compatíveis com seu veículo na região, elas aparecem aqui. Fique online para receber as ofertas na hora."
          />
        ) : (
          items.map((item) => (
            <div
              key={`${item.kind}-${item._id}`}
              className="bg-surface rounded-panel border border-line p-4 shadow-raised"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className={`text-xs font-semibold uppercase tracking-wide ${
                  item.kind === 'parcel' ? 'text-brand-600' : 'text-ink-600'
                }`}
                >
                  {item.kind === 'parcel' ? 'Encomenda' : 'Corrida'}
                  {item.vehicleType ? ` · ${item.vehicleType === 'moto' ? 'Moto' : 'Carro'}` : ''}
                </span>
                <span className="text-sm font-bold text-ink-900">
                  R$ {Number(item.fare || 0).toFixed(2).replace('.', ',')}
                </span>
              </div>
              <p className="text-sm font-medium text-ink-900 flex items-center gap-1.5">
                <i className="ri-time-line text-brand-500" aria-hidden="true" />
                {formatWhen(item.scheduledAt)}
              </p>
              {item.itemName && (
                <p className="text-xs text-ink-500 mt-1">Item: {item.itemName}</p>
              )}
              <p className="text-xs text-ink-600 mt-2 truncate">
                <i className="ri-map-pin-user-fill text-brand-500" aria-hidden="true" /> {item.pickup}
              </p>
              <p className="text-xs text-ink-600 truncate">
                <i className="ri-map-pin-2-fill text-danger-500" aria-hidden="true" /> {item.destination}
              </p>
              <p className="text-[11px] text-ink-400 mt-3">
                Sem botão de aceite aqui — aguarde a notificação/oferta no horário.
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default CaptainScheduled
