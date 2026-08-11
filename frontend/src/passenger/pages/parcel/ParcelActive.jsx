import React, { useContext, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import { SocketContext } from '@/shared/contexts/SocketContext'
import LiveTracking from '@/shared/components/LiveTracking'
import RideChat from '@/shared/components/RideChat'
import { cancelParcel, getCurrentParcel, skipParcelReview } from '@/shared/services/parcelApi'
import { submitReview } from '@/shared/services/reviewApi'
import { getAccessToken } from '@/shared/services/session'
import { useToast } from '@/shared/contexts/ToastContext'
import { RideContext } from '@/shared/contexts/RideContext'
import Button from '@/shared/components/ui/Button'
import DriverIdentityCard from '@/shared/components/DriverIdentityCard'
import { formatCurrencyBRL } from '@/shared/utils/formatters'

const STATUS_COPY = {
  awaiting_provider: {
    title: 'Procurando um motorista…',
    subtitle: 'Estamos avisando prestadores próximos',
  },
  provider_accepted: {
    title: 'Motorista encontrado',
    subtitle: 'Ele vai até o local de coleta',
  },
  going_to_pickup: {
    title: 'A caminho da coleta',
    subtitle: 'Acompanhe a localização no mapa',
  },
  arrived_pickup: {
    title: 'Chegou na coleta',
    subtitle: 'O prestador está no local de retirada',
  },
  collected: {
    title: 'Encomenda coletada',
    subtitle: 'Objeto em posse do prestador',
  },
  in_transit: {
    title: 'Em trânsito',
    subtitle: 'Sua encomenda está a caminho do destino',
  },
  arrived_destination: {
    title: 'Chegou ao destino',
    subtitle: 'Informe o PIN ao prestador para confirmar',
  },
  delivered: {
    title: 'Encomenda entregue',
    subtitle: 'Entrega concluída com sucesso',
  },
  finished: {
    title: 'Encomenda entregue',
    subtitle: 'Como foi a experiência?',
  },
  cancelled: {
    title: 'Encomenda cancelada',
    subtitle: 'Esta solicitação foi encerrada',
  },
}

/** Timeline compacta — 5 marcos mapeados aos status do backend */
const TIMELINE = [
  { id: 'request', label: 'Solicitação', statuses: ['awaiting_provider'] },
  {
    id: 'driver',
    label: 'Motorista',
    statuses: ['provider_accepted', 'going_to_pickup', 'arrived_pickup'],
  },
  { id: 'pickup', label: 'Coleta', statuses: ['collected'] },
  {
    id: 'transit',
    label: 'Trânsito',
    statuses: ['in_transit', 'arrived_destination'],
  },
  { id: 'done', label: 'Entrega', statuses: ['delivered', 'finished'] },
]

const CHAT_STATUSES = [
  'provider_accepted',
  'going_to_pickup',
  'arrived_pickup',
  'collected',
  'in_transit',
  'arrived_destination',
]

const CANCEL_STATUSES = [
  'awaiting_provider',
  'provider_accepted',
  'going_to_pickup',
  'arrived_pickup',
]

const PIN_VISIBLE_STATUSES = [
  'provider_accepted',
  'going_to_pickup',
  'arrived_pickup',
  'collected',
  'in_transit',
  'arrived_destination',
]

const PIN_EMPHASIS = ['collected', 'in_transit', 'arrived_destination']

function timelineIndex(status) {
  if (status === 'cancelled') return -1
  const idx = TIMELINE.findIndex((step) => step.statuses.includes(status))
  if (idx >= 0) return idx
  // Status intermediários: marca o último marco já alcançado
  const order = [
    'awaiting_provider',
    'provider_accepted',
    'going_to_pickup',
    'arrived_pickup',
    'collected',
    'in_transit',
    'arrived_destination',
    'delivered',
    'finished',
  ]
  const pos = order.indexOf(status)
  if (pos <= 0) return 0
  if (pos <= 3) return 1
  if (pos === 4) return 2
  if (pos <= 6) return 3
  return 4
}

function shortAddress(address) {
  if (!address) return '—'
  return String(address).split(',')[0] || address
}

const ParcelTimeline = ({ status }) => {
  const active = timelineIndex(status)
  if (status === 'cancelled') return null

  return (
    <ol className="flex items-start justify-between gap-1 px-0.5" aria-label="Progresso da encomenda">
      {TIMELINE.map((step, i) => {
        const done = i < active
        const current = i === active
        return (
          <li key={step.id} className="flex-1 flex flex-col items-center min-w-0">
            <div className="flex items-center w-full">
              {i > 0 && (
                <div
                  className={`h-0.5 flex-1 rounded-full ${done || current ? 'bg-brand-500' : 'bg-line'}`}
                  aria-hidden="true"
                />
              )}
              <span
                className={`
                  flex-shrink-0 w-2.5 h-2.5 rounded-full border-2
                  ${current ? 'border-brand-500 bg-brand-500 scale-125' : ''}
                  ${done && !current ? 'border-brand-500 bg-brand-500' : ''}
                  ${!done && !current ? 'border-line bg-surface' : ''}
                `}
                aria-current={current ? 'step' : undefined}
              />
              {i < TIMELINE.length - 1 && (
                <div
                  className={`h-0.5 flex-1 rounded-full ${done ? 'bg-brand-500' : 'bg-line'}`}
                  aria-hidden="true"
                />
              )}
            </div>
            <span
              className={`mt-1.5 text-[10px] leading-tight text-center truncate w-full ${
                current ? 'font-semibold text-brand-700' : 'text-ink-400'
              }`}
            >
              {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

const ParcelActive = () => {
  const { state } = useLocation()
  const navigate = useNavigate()
  const { socket } = useContext(SocketContext)
  const { setUserParcel, clearUserParcel } = useContext(RideContext)
  const { addToast } = useToast()

  const [parcel, setParcel] = useState(state?.parcel || null)
  const [loadingCurrent, setLoadingCurrent] = useState(!state?.parcel)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [ratingValue, setRatingValue] = useState(0)
  const [ratingComment, setRatingComment] = useState('')
  const [submittingRating, setSubmittingRating] = useState(false)
  const [rated, setRated] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [sendingPin, setSendingPin] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const current = await getCurrentParcel()
        if (!alive) return
        if (current) {
          setParcel(current)
          setUserParcel(current)
        } else if (!state?.parcel) {
          setParcel(null)
        }
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoadingCurrent(false)
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!socket) return undefined
    // deliveryPin é select:false no BE — sockets não trazem o PIN; preserva o local.
    const mergeParcel = (data) => {
      setParcel((prev) => {
        const next = {
          ...data,
          deliveryPin: data?.deliveryPin || prev?.deliveryPin,
        }
        setUserParcel(next)
        return next
      })
    }
    const onUpdate = (data) => {
      mergeParcel(data)
    }
    const onEnded = (data) => {
      mergeParcel(data)
      addToast('Encomenda finalizada', 'success')
    }
    const onCancelled = () => {
      clearUserParcel()
      addToast('Encomenda cancelada', 'info')
      navigate('/home')
    }
    socket.on('parcel-confirmed', onUpdate)
    socket.on('parcel-status-updated', onUpdate)
    socket.on('parcel-delivered', onEnded)
    socket.on('parcel-ended', onEnded)
    socket.on('parcel-cancelled', onCancelled)
    return () => {
      socket.off('parcel-confirmed', onUpdate)
      socket.off('parcel-status-updated', onUpdate)
      socket.off('parcel-delivered', onEnded)
      socket.off('parcel-ended', onEnded)
      socket.off('parcel-cancelled', onCancelled)
    }
  }, [socket, navigate, addToast, clearUserParcel, setUserParcel])

  useEffect(() => {
    if (!confirmingCancel) return undefined
    const t = setTimeout(() => setConfirmingCancel(false), 5000)
    return () => clearTimeout(t)
  }, [confirmingCancel])

  const copy = useMemo(
    () => STATUS_COPY[parcel?.status] || { title: parcel?.status || 'Encomenda', subtitle: '' },
    [parcel?.status]
  )

  const handleCancel = async () => {
    if (cancelling || !parcel?._id) return
    if (!confirmingCancel) {
      setConfirmingCancel(true)
      return
    }
    setCancelling(true)
    try {
      await cancelParcel(parcel._id)
      clearUserParcel()
      navigate('/home')
    } catch (err) {
      addToast(err.response?.data?.message || 'Não foi possível cancelar', 'error')
    } finally {
      setCancelling(false)
      setConfirmingCancel(false)
    }
  }

  const handleSubmitRating = async () => {
    if (!ratingValue) return
    setSubmittingRating(true)
    try {
      await submitReview({
        subjectType: 'parcel',
        parcelId: parcel._id,
        rating: ratingValue,
        comment: ratingComment,
      })
      setRated(true)
      clearUserParcel()
      addToast('Avaliação enviada', 'success')
    } catch (err) {
      addToast(err.response?.data?.message || 'Não foi possível avaliar', 'error')
    } finally {
      setSubmittingRating(false)
    }
  }

  if (loadingCurrent && !parcel) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface gap-3 px-6">
        <i className="ri-loader-4-line text-3xl text-brand-500 animate-spin" aria-hidden="true" />
        <p className="text-ink-600 font-medium">Carregando encomenda…</p>
      </div>
    )
  }

  if (!parcel) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface gap-4 px-6">
        <div className="w-14 h-14 rounded-full bg-surface-alt border border-line flex items-center justify-center">
          <i className="ri-box-3-line text-2xl text-ink-400" aria-hidden="true" />
        </div>
        <p className="text-ink-600 font-medium text-center">Nenhuma encomenda ativa</p>
        <Button onClick={() => navigate('/home')} className="max-w-xs">
          Voltar ao início
        </Button>
      </div>
    )
  }

  const captain = parcel.captain
  const captainLoc = captain?.location
    ? { lat: captain.location.ltd, lng: captain.location.lng }
    : null
  const searching = parcel.status === 'awaiting_provider'
  const canChat = CHAT_STATUSES.includes(parcel.status) && !!captain
  const showRating = parcel.status === 'finished' && !rated
  // requireDeliveryPin === false (config admin, por tipo de veículo) esconde
  // o PIN inteiro — não faz sentido mostrar/pedir pra enviar um código que o
  // motorista nem vai precisar digitar. undefined (resposta antiga sem o
  // campo) cai no lado seguro e mostra, igual sempre foi.
  const showPin = Boolean(parcel.deliveryPin)
    && parcel.requireDeliveryPin !== false
    && PIN_VISIBLE_STATUSES.includes(parcel.status)
  const pinEmphasized = PIN_EMPHASIS.includes(parcel.status)

  const sendPinViaChat = async () => {
    if (!parcel?._id || !parcel.deliveryPin || sendingPin) return
    setSendingPin(true)
    try {
      const token = getAccessToken('user')
      const message = `PIN da entrega: ${parcel.deliveryPin}`
      await api.post(
        `${import.meta.env.VITE_BASE_URL}/chat/send`,
        {
          subjectType: 'parcel',
          subjectId: parcel._id,
          message,
          type: 'text',
          operationalType: 'delivery_pin',
        },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      addToast('PIN enviado ao motorista pelo chat', 'success')
      setIsChatOpen(true)
    } catch {
      addToast('Não foi possível enviar o PIN pelo chat', 'error')
    } finally {
      setSendingPin(false)
    }
  }

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row bg-surface overflow-hidden">
      {/* Mapa — ocupa o restante; painel inferior ~35% */}
      <div className="flex-1 min-h-0 md:h-full md:flex-1 relative">
        <LiveTracking
          pickup={parcel.pickupCoordinates}
          destination={parcel.destinationCoordinates}
          captainLocation={captainLoc}
          parcelId={parcel._id}
          status={parcel.status}
        />
        <button
          type="button"
          onClick={() => navigate('/home')}
          className="absolute top-3 left-3 z-10 min-w-[44px] min-h-[44px] rounded-full bg-surface shadow-raised border border-line flex items-center justify-center active:scale-95"
          aria-label="Voltar"
        >
          <i className="ri-arrow-left-line text-xl text-ink-900" aria-hidden="true" />
        </button>
        {canChat && (
          <button
            type="button"
            onClick={() => setIsChatOpen(true)}
            className="absolute top-3 right-3 z-10 min-w-[44px] min-h-[44px] rounded-full bg-surface shadow-raised border border-line flex items-center justify-center active:scale-95"
            aria-label="Abrir chat"
          >
            <i className="ri-chat-3-line text-xl text-ink-900" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Painel sempre aberto — altura pelo conteúdo, sem scroll/expansão */}
      <div className="flex-shrink-0 w-full md:max-w-md md:h-full md:overflow-y-auto md:border-l bg-surface border-t md:border-t-0 border-line rounded-t-3xl md:rounded-none shadow-floating md:shadow-none -mt-3 md:mt-0 relative z-10 flex flex-col">
        <div className="mx-auto mt-2 mb-0.5 h-1 w-10 rounded-full bg-line flex-shrink-0" aria-hidden="true" />

        <div className="px-3.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
          {/* Status */}
          <div className="pt-0.5">
            <div className="flex items-start gap-2.5">
              {searching ? (
                <span className="mt-1 flex-shrink-0 w-2.5 h-2.5 rounded-full bg-brand-500 animate-pulse" aria-hidden="true" />
              ) : (
                <span className="mt-1 flex-shrink-0 w-2.5 h-2.5 rounded-full bg-brand-500" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold text-ink-900 leading-tight">{copy.title}</h1>
                {copy.subtitle && (
                  <p className="text-xs text-ink-400 mt-0.5 truncate">{copy.subtitle}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-ink-900">
	                  {formatCurrencyBRL(parcel.fare || 0)}
                </p>
                <p className="text-[10px] text-ink-400">
                  {parcel.paymentMethod === 'pix' ? 'Pix' : 'Dinheiro'}
                </p>
              </div>
            </div>
          </div>

          <ParcelTimeline status={parcel.status} />

          {/* Motorista — só após aceite (vínculo real) */}
          {captain && !searching && (
            <DriverIdentityCard
              captain={captain}
              vehicleTypeFallback={parcel.vehicleType}
              compact
            />
          )}

          {/* Procurando — animação + rota */}
          {searching && (
            <div className="rounded-panel border border-line bg-brand-50/60 px-3 py-2 flex items-center gap-2.5" role="status">
              <i className="ri-radar-line text-xl text-brand-600 animate-pulse" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink-900">Buscando prestadores próximos</p>
                <p className="text-[11px] text-ink-400 truncate">
                  {shortAddress(parcel.pickup)} → {shortAddress(parcel.destination)}
                </p>
              </div>
            </div>
          )}

          {/* PIN — visível o tempo todo após o motorista aceitar */}
          {showPin && (
            <div
              className={`rounded-panel border px-2.5 py-2 space-y-1.5 ${
                pinEmphasized
                  ? 'bg-brand-50 border-brand-200'
                  : 'bg-surface-alt border-line'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <p className="text-[10px] text-ink-400 uppercase tracking-wide flex-shrink-0">PIN</p>
                <p
                  className={`flex-1 text-center font-bold tracking-[0.3em] leading-none ${
                    pinEmphasized ? 'text-2xl text-brand-600' : 'text-xl text-ink-900'
                  }`}
                >
                  {parcel.deliveryPin}
                </p>
                <i className="ri-lock-2-line text-base text-brand-500 flex-shrink-0" aria-hidden="true" />
              </div>
              {canChat && (
                <button
                  type="button"
                  disabled={sendingPin}
                  onClick={sendPinViaChat}
                  className="w-full min-h-[40px] rounded-panel border border-brand-200 bg-white text-brand-700 text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <i className="ri-chat-smile-2-line text-base" aria-hidden="true" />
                  {sendingPin ? 'Enviando…' : 'Enviar PIN no chat'}
                </button>
              )}
            </div>
          )}

          {/* Destinatário + rota sempre visíveis */}
          <div className="space-y-1.5">
            {(parcel.recipient?.name || parcel.itemName) && (
              <p className="text-xs text-ink-600 flex items-center gap-2 min-w-0">
                <i className="ri-user-received-line text-ink-400 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {parcel.recipient?.name || parcel.itemName}
                  {parcel.recipient?.name && parcel.itemName ? ` · ${parcel.itemName}` : ''}
                  {parcel.vehicleType ? ` · ${parcel.vehicleType === 'moto' ? 'Moto' : 'Carro'}` : ''}
                </span>
              </p>
            )}
            <div className="flex gap-3 text-xs text-ink-600">
              <p className="flex items-center gap-1.5 min-w-0 flex-1">
                <i className="ri-map-pin-user-fill text-brand-500 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{shortAddress(parcel.pickup)}</span>
              </p>
              <p className="flex items-center gap-1.5 min-w-0 flex-1">
                <i className="ri-map-pin-2-fill text-danger-500 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{shortAddress(parcel.destination)}</span>
              </p>
            </div>
            {parcel.recipient?.phone && (
              <p className="text-xs text-ink-500 flex items-center gap-1.5">
                <i className="ri-phone-line text-ink-400" aria-hidden="true" />
                {parcel.recipient.phone}
              </p>
            )}
          </div>

          {/* Avaliação */}
          {showRating && (
            <div className="space-y-3 border-t border-line pt-3">
              <p className="text-sm font-semibold text-ink-900">Como foi a entrega?</p>
              <div className="flex justify-center gap-2" role="group" aria-label="Nota de 1 a 5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRatingValue(star)}
                    aria-pressed={star <= ratingValue}
                    aria-label={`${star} estrela${star > 1 ? 's' : ''}`}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center"
                  >
                    <i
                      className={`text-3xl ${
                        star <= ratingValue ? 'ri-star-fill text-amber-400' : 'ri-star-line text-ink-400/40'
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
              <textarea
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
                placeholder="Comentário opcional — o que podemos melhorar?"
                className="w-full border border-line rounded-panel p-3 text-sm bg-surface-alt focus:outline-none focus:border-brand-500"
                rows={2}
              />
              <Button
                loading={submittingRating}
                disabled={!ratingValue || submittingRating}
                onClick={handleSubmitRating}
              >
                Enviar avaliação
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await skipParcelReview(parcel._id)
                  } catch {
                    /* still leave */
                  }
                  clearUserParcel()
                  navigate('/home')
                }}
              >
                Pular e voltar
              </Button>
            </div>
          )}

          {parcel.status === 'finished' && rated && (
            <Button onClick={() => navigate('/home')}>Voltar ao início</Button>
          )}

          {/* Cancelar */}
          {CANCEL_STATUSES.includes(parcel.status) && (
            <Button
              variant="danger"
              loading={cancelling}
              onClick={handleCancel}
              className="!min-h-[40px] !text-sm"
            >
              {confirmingCancel ? 'Toque de novo para confirmar' : 'Cancelar encomenda'}
            </Button>
          )}
        </div>
      </div>

      {canChat && (
        <RideChat
          subject={parcel}
          subjectType="parcel"
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          currentUserType="user"
          deliveryPin={parcel.requireDeliveryPin !== false ? parcel.deliveryPin : undefined}
        />
      )}
    </div>
  )
}

export default ParcelActive
