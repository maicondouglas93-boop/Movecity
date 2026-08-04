import React, { useContext, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SocketContext } from '@/shared/contexts/SocketContext'
import LiveTracking from '@/shared/components/LiveTracking'
import RideChat from '@/shared/components/RideChat'
import { cancelParcel, getCurrentParcel } from '@/shared/services/parcelApi'
import { submitReview } from '@/shared/services/reviewApi'
import { useToast } from '@/shared/contexts/ToastContext'
import { RideContext } from '@/shared/contexts/RideContext'

const STATUS_LABEL = {
  awaiting_provider: 'Aguardando Prestador',
  provider_accepted: 'Prestador Aceitou',
  going_to_pickup: 'Indo para Retirada',
  arrived_pickup: 'Chegou na Retirada',
  collected: 'Objeto Coletado',
  in_transit: 'Em Transporte',
  arrived_destination: 'Chegou ao Destino',
  delivered: 'Entregue',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
}

const CHAT_STATUSES = [
  'provider_accepted',
  'going_to_pickup',
  'arrived_pickup',
  'collected',
  'in_transit',
  'arrived_destination',
]

const ParcelActive = () => {
  const { state } = useLocation()
  const navigate = useNavigate()
  const { socket } = useContext(SocketContext)
  const { setUserParcel, clearUserParcel } = useContext(RideContext)
  const { addToast } = useToast()
  const [parcel, setParcel] = useState(state?.parcel || null)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [ratingValue, setRatingValue] = useState(0)
  const [ratingComment, setRatingComment] = useState('')
  const [submittingRating, setSubmittingRating] = useState(false)
  const [rated, setRated] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const current = await getCurrentParcel()
        if (alive && current) {
          setParcel(current)
          setUserParcel(current)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!socket) return undefined
    const onUpdate = (data) => setParcel(data)
    const onEnded = (data) => {
      setParcel(data)
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
  }, [socket, navigate, addToast, clearUserParcel])

  if (!parcel) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface gap-4 px-6">
        <p className="text-ink-500">Nenhuma encomenda ativa</p>
        <button
          type="button"
          className="min-h-[44px] px-6 rounded-panel bg-brand-500 text-white font-semibold"
          onClick={() => navigate('/home')}
        >
          Voltar ao início
        </button>
      </div>
    )
  }

  const captainLoc = parcel.captain?.location
    ? { lat: parcel.captain.location.ltd, lng: parcel.captain.location.lng }
    : null

  const canChat = CHAT_STATUSES.includes(parcel.status) && !!parcel.captain
  const showRating = parcel.status === 'finished' && !rated

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

  return (
    <div className="h-screen flex flex-col bg-surface">
      <div className="flex-1 relative">
        <LiveTracking
          pickup={parcel.pickupCoordinates}
          destination={parcel.destinationCoordinates}
          captainLocation={captainLoc}
          parcelId={parcel._id}
        />
        {canChat && (
          <button
            type="button"
            onClick={() => setIsChatOpen(true)}
            className="absolute top-4 right-4 z-10 bg-white shadow-md rounded-full w-12 h-12 flex items-center justify-center"
            aria-label="Abrir chat"
          >
            <i className="ri-chat-3-line text-xl text-ink-800" />
          </button>
        )}
      </div>
      <div className="bg-surface border-t border-line rounded-t-2xl p-4 space-y-3 max-h-[45dvh] overflow-y-auto">
        <p className="text-sm font-semibold text-brand-600">
          {STATUS_LABEL[parcel.status] || parcel.status}
        </p>
        <p className="text-sm text-ink-700">{parcel.itemName} · {parcel.vehicleType}</p>
        <p className="text-xs text-ink-400 truncate">Retirada: {parcel.pickup}</p>
        <p className="text-xs text-ink-400 truncate">Entrega: {parcel.destination}</p>
        {parcel.deliveryPin && !['finished', 'cancelled', 'delivered'].includes(parcel.status) && (
          <div className="bg-brand-50 border border-brand-200 rounded-panel p-3 text-center">
            <p className="text-xs text-ink-500">PIN para o destinatário</p>
            <p className="text-3xl font-bold tracking-widest text-ink-900">{parcel.deliveryPin}</p>
          </div>
        )}
        <p className="text-lg font-bold text-ink-900">
          R$ {Number(parcel.fare || 0).toFixed(2).replace('.', ',')}
        </p>

        {showRating && (
          <div className="space-y-3 border-t border-line pt-3">
            <p className="text-sm font-semibold text-ink-800">Como foi a entrega?</p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRatingValue(star)}
                  aria-pressed={star <= ratingValue}
                >
                  <i className={`text-3xl ${star <= ratingValue ? 'ri-star-fill text-amber-400' : 'ri-star-line text-ink-400/40'}`} />
                </button>
              ))}
            </div>
            <textarea
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              placeholder="Comentário (opcional)"
              className="w-full border border-line rounded-panel p-3 text-sm"
              rows={2}
            />
            <button
              type="button"
              disabled={!ratingValue || submittingRating}
              onClick={handleSubmitRating}
              className="w-full min-h-[44px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50"
            >
              Enviar avaliação
            </button>
            <button
              type="button"
              className="w-full min-h-[44px] rounded-panel border border-line text-ink-700 font-medium"
              onClick={() => {
                clearUserParcel()
                navigate('/home')
              }}
            >
              Pular e voltar
            </button>
          </div>
        )}

        {['awaiting_provider', 'provider_accepted', 'going_to_pickup', 'arrived_pickup'].includes(parcel.status) && (
          <button
            type="button"
            className="w-full min-h-[44px] rounded-panel border border-line text-ink-700 font-medium"
            onClick={async () => {
              try {
                await cancelParcel(parcel._id)
                clearUserParcel()
                navigate('/home')
              } catch (err) {
                addToast(err.response?.data?.message || 'Não foi possível cancelar', 'error')
              }
            }}
          >
            Cancelar encomenda
          </button>
        )}

        {(parcel.status === 'finished' && rated) && (
          <button
            type="button"
            className="w-full min-h-[44px] rounded-panel bg-brand-500 text-white font-semibold"
            onClick={() => navigate('/home')}
          >
            Voltar ao início
          </button>
        )}
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
