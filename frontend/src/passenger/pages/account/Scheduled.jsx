import React, { useState, useEffect } from 'react'
import { getAccessToken } from '@/shared/services/session'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import PageHeader from '@/shared/components/ui/PageHeader'
import EmptyState from '@/shared/components/ui/EmptyState'
import Button from '@/shared/components/ui/Button'
import { useToast } from '@/shared/contexts/ToastContext'

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

const isSearching = (item) =>
  item.status === 'requested' || item.status === 'awaiting_provider'

const Scheduled = () => {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [scheduled, setScheduled] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [cancellingId, setCancellingId] = useState(null)

  const fetchScheduled = async () => {
    try {
      const response = await api.get(`${import.meta.env.VITE_BASE_URL}/users/scheduled`, {
        headers: { Authorization: `Bearer ${getAccessToken('user')}` },
      })
      setScheduled(response.data.scheduled || [])
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchScheduled()
  }, [])

  const cancelItem = async (item) => {
    if (cancellingId) return
    setCancellingId(item._id)
    try {
      await api.post(
        `${import.meta.env.VITE_BASE_URL}/schedules/mine/cancel`,
        { kind: item.kind, id: item._id },
        { headers: { Authorization: `Bearer ${getAccessToken('user')}` } },
      )
      setScheduled((prev) => prev.filter((x) => x._id !== item._id))
      addToast('Agendamento cancelado', 'success')
    } catch (err) {
      addToast(err.response?.data?.message || 'Não foi possível cancelar', 'error')
    } finally {
      setCancellingId(null)
    }
  }

  const followItem = (item) => {
    if (item.kind === 'parcel') {
      navigate('/encomenda/ativa')
      return
    }
    navigate('/home')
  }

  return (
    <div className="h-screen bg-surface-alt flex flex-col font-sans">
      <PageHeader title="Agendamentos" onBack={() => navigate('/agendar')} />

      <div className="flex-1 p-5 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center my-10">
            <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true" />
          </div>
        ) : loadError ? (
          <EmptyState
            variant="error"
            icon="ri-error-warning-line"
            title="Não foi possível carregar seus agendamentos"
            description="Tente novamente mais tarde."
          />
        ) : scheduled.length > 0 ? (
          <div className="flex flex-col gap-4">
            {scheduled.map((item) => (
              <div
                key={`${item.kind}-${item._id}`}
                className="bg-surface rounded-panel p-4 shadow-raised border border-line"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                      {item.kind === 'parcel' ? 'Encomenda' : 'Corrida'}
                      {item.status === 'scheduled' ? ' · Agendada' : ''}
                    </p>
                    <h4 className="font-semibold text-ink-900 truncate">
                      {item.kind === 'parcel' && item.itemName
                        ? item.itemName
                        : item.destination}
                    </h4>
                    <p className="text-sm text-ink-400 mt-1">
                      <i className="ri-time-line" aria-hidden="true" /> {formatWhen(item.scheduledAt)}
                    </p>
                    {isSearching(item) && (
                      <p className="text-xs text-brand-600 mt-1 font-medium">
                        Buscando motorista…
                      </p>
                    )}
                    <p className="text-xs text-ink-500 mt-1 truncate">{item.pickup} → {item.destination}</p>
                    <p className="text-sm font-semibold text-ink-900 mt-1">
                      R$ {Number(item.fare || 0).toFixed(2).replace('.', ',')}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {isSearching(item) && (
                    <button
                      type="button"
                      onClick={() => followItem(item)}
                      className="text-brand-700 bg-brand-50 px-3 py-1.5 rounded-lg text-sm font-medium"
                    >
                      Acompanhar
                    </button>
                  )}
                  {(item.status === 'scheduled' || isSearching(item)) && (
                    <button
                      type="button"
                      disabled={cancellingId === item._id}
                      onClick={() => cancelItem(item)}
                      className="text-danger-500 bg-danger-50 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {cancellingId === item._id ? '…' : 'Cancelar'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="ri-calendar-todo-line"
            title="Nenhum agendamento"
            description="Você ainda não agendou corrida ou encomenda."
          />
        )}
      </div>

      <div className="p-5 bg-surface border-t border-line pb-10">
        <Button onClick={() => navigate('/agendar')}>
          <i className="ri-calendar-check-line text-xl" aria-hidden="true" />
          Novo agendamento
        </Button>
      </div>
    </div>
  )
}

export default Scheduled
