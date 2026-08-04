import React, { useContext, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import LiveTracking from '@/shared/components/LiveTracking'
import RideChat from '@/shared/components/RideChat'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { RideContext } from '@/shared/contexts/RideContext'
import {
  confirmParcelDelivery,
  getCaptainCurrentParcel,
  updateParcelStatus,
} from '@/shared/services/parcelApi'
import { submitCaptainReview } from '@/shared/services/reviewApi'
import { useToast } from '@/shared/contexts/ToastContext'

const NEXT_STATUS = {
  provider_accepted: 'going_to_pickup',
  going_to_pickup: 'arrived_pickup',
  arrived_pickup: 'collected',
  collected: 'in_transit',
  in_transit: 'arrived_destination',
}

const NEXT_LABEL = {
  provider_accepted: 'Indo para retirada',
  going_to_pickup: 'Cheguei na retirada',
  arrived_pickup: 'Objeto coletado',
  collected: 'Em transporte',
  in_transit: 'Cheguei ao destino',
}

const CHAT_STATUSES = [
  'provider_accepted',
  'going_to_pickup',
  'arrived_pickup',
  'collected',
  'in_transit',
  'arrived_destination',
]

const CaptainParcelRiding = () => {
  const { state } = useLocation()
  const navigate = useNavigate()
  const { socket } = useContext(SocketContext)
  const { setCaptainParcel } = useContext(RideContext)
  const { addToast } = useToast()
  const [parcel, setParcel] = useState(state?.parcel || null)
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [step, setStep] = useState('active') // active | rating
  const [ratingValue, setRatingValue] = useState(0)
  const [submittingRating, setSubmittingRating] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const current = await getCaptainCurrentParcel()
        if (!alive) return
        if (current) {
          setParcel(current)
          setCaptainParcel(current)
          return
        }
        // Refresh durante rating: API current some, mas location.state pode ter finished.
        if (state?.parcel?.status === 'finished' || state?.step === 'rating') {
          setParcel(state.parcel)
          setStep('rating')
        }
      } catch {
        /* ignore */
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!socket) return undefined
    const onCancelled = () => {
      setCaptainParcel(null)
      addToast('Encomenda cancelada pelo cliente', 'info')
      navigate('/captain-home')
    }
    socket.on('parcel-cancelled', onCancelled)
    return () => socket.off('parcel-cancelled', onCancelled)
  }, [socket, navigate, addToast, setCaptainParcel])

  if (!parcel) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-ink-500">Nenhuma encomenda ativa</p>
        <button
          type="button"
          className="min-h-[44px] px-6 rounded-panel bg-brand-500 text-white font-semibold"
          onClick={() => {
            setCaptainParcel(null)
            navigate('/captain-home')
          }}
        >
          Voltar ao início
        </button>
      </div>
    )
  }

  const advance = async () => {
    const next = NEXT_STATUS[parcel.status]
    if (!next) return
    setLoading(true)
    try {
      const updated = await updateParcelStatus(parcel._id, next)
      setParcel(updated)
    } catch (err) {
      addToast(err.response?.data?.message || 'Falha ao atualizar status', 'error')
    } finally {
      setLoading(false)
    }
  }

  const confirmPin = async () => {
    setLoading(true)
    try {
      const updated = await confirmParcelDelivery(parcel._id, pin)
      setParcel(updated)
      // Mantém parcel finished no state para o rating sobreviver a refresh parcial.
      setCaptainParcel(null)
      addToast('Entrega confirmada!', 'success')
      setStep('rating')
      navigate('/captain-parcel', { replace: true, state: { parcel: updated, step: 'rating' } })
    } catch (err) {
      addToast(err.response?.data?.message || 'PIN inválido', 'error')
    } finally {
      setLoading(false)
    }
  }

  const submitRating = async () => {
    if (!ratingValue) return
    setSubmittingRating(true)
    try {
      await submitCaptainReview({
        subjectType: 'parcel',
        parcelId: parcel._id,
        rating: ratingValue,
      })
      setCaptainParcel(null)
      navigate('/captain-home')
    } catch (err) {
      addToast(err.response?.data?.message || 'Não foi possível avaliar', 'error')
    } finally {
      setSubmittingRating(false)
    }
  }

  const canChat = CHAT_STATUSES.includes(parcel.status)

  return (
    <div className="h-screen flex flex-col bg-surface">
      <div className="flex-1 relative">
        <LiveTracking
          pickup={parcel.pickupCoordinates}
          destination={parcel.destinationCoordinates}
          parcelId={parcel._id}
        />
        {canChat && step === 'active' && (
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
      <div className="p-4 border-t border-line space-y-3 max-h-[48dvh] overflow-y-auto">
        {step === 'rating' ? (
          <div className="space-y-3">
            <p className="font-semibold text-ink-900">Avalie o cliente</p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRatingValue(n)}>
                  <i className={`text-4xl ${n <= ratingValue ? 'ri-star-fill text-yellow-400' : 'ri-star-line text-ink-400'}`} />
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!ratingValue || submittingRating}
              onClick={submitRating}
              className="w-full min-h-[48px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50"
            >
              Enviar e voltar
            </button>
            <button
              type="button"
              className="w-full min-h-[44px] rounded-panel border border-line text-ink-700 font-medium"
              onClick={() => {
                setCaptainParcel(null)
                navigate('/captain-home')
              }}
            >
              Pular
            </button>
          </div>
        ) : (
          <>
            <p className="font-semibold text-ink-900">{parcel.itemName}</p>
            <p className="text-xs text-ink-400">Retirada: {parcel.pickup}</p>
            <p className="text-xs text-ink-400">Entrega: {parcel.destination}</p>
            <p className="text-sm text-ink-600">Destinatário: {parcel.recipient?.name} · {parcel.recipient?.phone}</p>

            {parcel.status === 'arrived_destination' ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-ink-700">Digite o PIN do destinatário</p>
                <input
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="w-full text-center text-2xl tracking-widest border border-line rounded-panel py-3"
                  placeholder="••••"
                />
                <button
                  type="button"
                  disabled={loading || pin.length < 4}
                  onClick={confirmPin}
                  className="w-full min-h-[48px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50"
                >
                  Confirmar entrega
                </button>
              </div>
            ) : NEXT_STATUS[parcel.status] ? (
              <button
                type="button"
                disabled={loading}
                onClick={advance}
                className="w-full min-h-[48px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50"
              >
                {NEXT_LABEL[parcel.status]}
              </button>
            ) : null}
          </>
        )}
      </div>

      {canChat && (
        <RideChat
          subject={parcel}
          subjectType="parcel"
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          currentUserType="captain"
        />
      )}
    </div>
  )
}

export default CaptainParcelRiding
