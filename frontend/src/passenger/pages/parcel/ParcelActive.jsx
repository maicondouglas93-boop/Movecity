import React, { useContext, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SocketContext } from '@/shared/contexts/SocketContext'
import LiveTracking from '@/shared/components/LiveTracking'
import RideChat from '@/shared/components/RideChat'
import { cancelParcel, getCurrentParcel, skipParcelReview } from '@/shared/services/parcelApi'
import { submitReview } from '@/shared/services/reviewApi'
import { useToast } from '@/shared/contexts/ToastContext'
import { RideContext } from '@/shared/contexts/RideContext'
import Button from '@/shared/components/ui/Button'
import { vehicleImages, vehicleLabels } from '@/shared/assets/vehicleAssets'

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

function captainDisplayName(captain) {
  if (!captain) return 'Motorista'
  const name = [captain.fullname?.firstname, captain.fullname?.lastname].filter(Boolean).join(' ')
  return name || captain.fullname?.firstname || 'Motorista'
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
  const [routeOpen, setRouteOpen] = useState(false)

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
    const onUpdate = (data) => {
      setParcel(data)
      setUserParcel(data)
    }
    const onEnded = (data) => {
      setParcel(data)
      setUserParcel(data)
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
  const showPin = Boolean(parcel.deliveryPin)
    && !['finished', 'cancelled', 'delivered'].includes(parcel.status)
  const pinEmphasized = PIN_EMPHASIS.includes(parcel.status)
  const vehicleType = captain?.vehicle?.vehicleType || parcel.vehicleType || 'car'
  const vehicleImg = vehicleImages[vehicleType] || vehicleImages.car
  const vehicleLabel = vehicleLabels[vehicleType] || vehicleType
  const mapHeight = searching ? 'h-[38dvh]' : 'h-[46dvh]'

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row bg-surface overflow-hidden">
      {/* Mapa */}
      <div className={`${mapHeight} md:h-full md:flex-1 relative flex-shrink-0`}>
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

      {/* Painel */}
      <div className="flex-1 min-h-0 md:max-w-md md:border-l bg-surface border-t md:border-t-0 border-line rounded-t-3xl md:rounded-none shadow-floating md:shadow-none -mt-3 md:mt-0 relative z-10 flex flex-col">
        <div className="mx-auto mt-2.5 mb-1 h-1 w-10 rounded-full bg-line flex-shrink-0" aria-hidden="true" />

        <div className="flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
          {/* Status */}
          <div className="pt-1">
            <div className="flex items-start gap-3">
              {searching ? (
                <span className="mt-1 flex-shrink-0 w-3 h-3 rounded-full bg-brand-500 animate-pulse" aria-hidden="true" />
              ) : (
                <span className="mt-1 flex-shrink-0 w-3 h-3 rounded-full bg-brand-500" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-semibold text-ink-900 leading-tight">{copy.title}</h1>
                {copy.subtitle && (
                  <p className="text-sm text-ink-400 mt-0.5">{copy.subtitle}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-base font-bold text-ink-900">
                  R$ {Number(parcel.fare || 0).toFixed(2).replace('.', ',')}
                </p>
                <p className="text-[11px] text-ink-400">Dinheiro</p>
              </div>
            </div>
          </div>

          <ParcelTimeline status={parcel.status} />

          {/* Motorista */}
          {captain && !searching && (
            <div className="flex items-center gap-3 rounded-panel border border-line bg-surface-alt p-3">
              {captain.profilePicture ? (
                <img
                  className="h-12 w-12 rounded-full object-cover flex-shrink-0 border border-line"
                  src={captain.profilePicture}
                  alt={captainDisplayName(captain)}
                  width="48"
                  height="48"
                  loading="lazy"
                />
              ) : (
                <img
                  className="h-12 w-12 object-contain flex-shrink-0"
                  src={vehicleImg}
                  alt={vehicleLabel}
                  width="64"
                  height="64"
                  loading="lazy"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-900 truncate capitalize">
                  {captainDisplayName(captain)}
                </p>
                <p className="text-xs text-ink-400 truncate capitalize">
                  {[captain.vehicle?.color, vehicleLabel].filter(Boolean).join(' · ')}
                  {captain.rating != null ? ` · ★ ${Number(captain.rating).toFixed(1)}` : ''}
                </p>
              </div>
              {captain.vehicle?.plate && (
                <p className="text-sm font-bold text-brand-700 tracking-wide flex-shrink-0">
                  {captain.vehicle.plate}
                </p>
              )}
            </div>
          )}

          {/* Procurando — animação + rota */}
          {searching && (
            <div className="rounded-panel border border-line bg-brand-50/60 px-4 py-3 flex items-center gap-3" role="status">
              <i className="ri-radar-line text-2xl text-brand-600 animate-pulse" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">Buscando prestadores próximos</p>
                <p className="text-xs text-ink-400 truncate">
                  {shortAddress(parcel.pickup)} → {shortAddress(parcel.destination)}
                </p>
              </div>
            </div>
          )}

          {/* PIN */}
          {showPin && (
            <div
              className={`rounded-panel border px-3 py-2.5 flex items-center gap-3 ${
                pinEmphasized
                  ? 'bg-brand-50 border-brand-200'
                  : 'bg-surface-alt border-line'
              }`}
            >
              <div className="flex-shrink-0">
                <p className="text-[11px] text-ink-400 uppercase tracking-wide">PIN</p>
                <p className="text-[11px] text-ink-400">Destinatário</p>
              </div>
              <p
                className={`flex-1 text-center font-bold tracking-[0.35em] leading-none ${
                  pinEmphasized ? 'text-3xl text-brand-600' : 'text-2xl text-ink-900'
                }`}
              >
                {parcel.deliveryPin}
              </p>
              <i className="ri-lock-2-line text-lg text-brand-500 flex-shrink-0" aria-hidden="true" />
            </div>
          )}

          {/* Rota colapsável */}
          <div>
            <button
              type="button"
              onClick={() => setRouteOpen((v) => !v)}
              className="w-full flex items-center justify-between min-h-[40px] text-xs font-medium text-ink-400"
              aria-expanded={routeOpen}
            >
              <span className="truncate">
                {parcel.itemName}
                {parcel.vehicleType ? ` · ${parcel.vehicleType === 'moto' ? 'Moto' : 'Carro'}` : ''}
              </span>
              <span className="flex items-center gap-1 flex-shrink-0 ml-2">
                {routeOpen ? 'Ocultar rota' : 'Ver rota'}
                <i className={`ri-arrow-${routeOpen ? 'up' : 'down'}-s-line`} aria-hidden="true" />
              </span>
            </button>
            {routeOpen && (
              <div className="space-y-2 pb-1">
                <p className="text-xs text-ink-600 flex items-start gap-2">
                  <i className="ri-map-pin-user-fill text-brand-500 mt-0.5" aria-hidden="true" />
                  <span>{parcel.pickup}</span>
                </p>
                <p className="text-xs text-ink-600 flex items-start gap-2">
                  <i className="ri-map-pin-2-fill text-danger-500 mt-0.5" aria-hidden="true" />
                  <span>{parcel.destination}</span>
                </p>
                {parcel.recipient?.name && (
                  <p className="text-xs text-ink-600 flex items-start gap-2">
                    <i className="ri-user-received-line text-ink-400 mt-0.5" aria-hidden="true" />
                    <span>
                      {parcel.recipient.name}
                      {parcel.recipient.phone ? ` · ${parcel.recipient.phone}` : ''}
                    </span>
                  </p>
                )}
              </div>
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
        />
      )}
    </div>
  )
}

export default ParcelActive
