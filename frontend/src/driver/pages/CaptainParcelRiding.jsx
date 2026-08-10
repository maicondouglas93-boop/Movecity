import React, { useContext, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import LiveTracking from '@/shared/components/LiveTracking'
import RideChat from '@/shared/components/RideChat'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { RideContext } from '@/shared/contexts/RideContext'
import {
  confirmParcelDelivery,
  confirmParcelPayment,
  getCaptainCurrentParcel,
  skipCaptainParcelReview,
  updateParcelStatus,
} from '@/shared/services/parcelApi'
import { submitCaptainReview } from '@/shared/services/reviewApi'
import { useToast } from '@/shared/contexts/ToastContext'
import PassengerIdentityCard from '@/shared/components/PassengerIdentityCard'
import { openWhatsApp } from '@/shared/utils/whatsapp'
import { buildGoogleMapsUrl } from '@/shared/utils/googleMaps'

const PARCEL_PICKUP_STATUSES = ['provider_accepted', 'going_to_pickup', 'arrived_pickup']

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
  const [step, setStep] = useState('active') // active | payment | rating
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [ratingValue, setRatingValue] = useState(0)
  const [submittingRating, setSubmittingRating] = useState(false)

  const resolveStep = (p) => {
    if (!p) return 'active'
    if (p.status === 'finished' && p.paymentStatus !== 'paid') return 'payment'
    if (p.status === 'finished') return 'rating'
    return 'active'
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const current = await getCaptainCurrentParcel()
        if (!alive) return
        if (current) {
          setParcel(current)
          setCaptainParcel(current)
          setStep(resolveStep(current))
          return
        }
        if (state?.parcel?.status === 'finished') {
          setParcel(state.parcel)
          setStep(state?.step === 'rating' && state.parcel.paymentStatus === 'paid'
            ? 'rating'
            : resolveStep(state.parcel))
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
      setCaptainParcel(updated)
      addToast('Entrega confirmada! Confirme o pagamento recebido.', 'success')
      setStep('payment')
      navigate('/captain-parcel', { replace: true, state: { parcel: updated, step: 'payment' } })
    } catch (err) {
      addToast(err.response?.data?.message || 'PIN inválido', 'error')
    } finally {
      setLoading(false)
    }
  }

  const confirmPayment = async () => {
    setLoading(true)
    try {
      const updated = await confirmParcelPayment(parcel._id)
      setParcel(updated)
      setCaptainParcel(updated)
      addToast('Pagamento confirmado.', 'success')
      setStep('rating')
      navigate('/captain-parcel', { replace: true, state: { parcel: updated, step: 'rating' } })
    } catch (err) {
      addToast(err.response?.data?.message || 'Falha ao confirmar pagamento', 'error')
    } finally {
      setLoading(false)
    }
  }

  const passengerAmount = Number(parcel?.fare ?? 0) || 0
  const payLabel = parcel?.paymentMethod === 'pix' ? 'Pix' : 'Dinheiro'

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

  // Etapa atual pra "Abrir no Google Maps": retirada enquanto o motorista
  // ainda não coletou o objeto, destino a partir de 'collected'.
  const onPickupLeg = PARCEL_PICKUP_STATUSES.includes(parcel.status)
  const mapsTarget = onPickupLeg
    ? { lat: parcel.pickupCoordinates?.lat, lng: parcel.pickupCoordinates?.lng, address: parcel.pickup }
    : { lat: parcel.destinationCoordinates?.lat, lng: parcel.destinationCoordinates?.lng, address: parcel.destination }
  const mapsUrl = buildGoogleMapsUrl(mapsTarget)

  return (
    <div className="h-screen flex flex-col bg-surface">
      <div className="flex-1 relative">
        <LiveTracking
          pickup={parcel.pickupCoordinates}
          destination={parcel.destinationCoordinates}
          parcelId={parcel._id}
          status={parcel.status}
          navigationMode={step === 'active'}
        />
        {step === 'active' && (
          <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-brand-500 text-white shadow-md rounded-full w-12 h-12 flex items-center justify-center"
                aria-label={onPickupLeg ? 'Navegar até a retirada' : 'Navegar até o destino'}
              >
                <i className="ri-navigation-fill text-xl" />
              </a>
            )}
            {canChat && (
              <button
                type="button"
                onClick={() => setIsChatOpen(true)}
                className="bg-white shadow-md rounded-full w-12 h-12 flex items-center justify-center"
                aria-label="Abrir chat"
              >
                <i className="ri-chat-3-line text-xl text-ink-800" />
              </button>
            )}
          </div>
        )}
      </div>
      <div className={`px-3.5 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-line space-y-2 rounded-t-3xl -mt-2 relative z-10 bg-surface shadow-floating transition-[max-height] duration-300 ease-in-out ${step === 'active' && detailsExpanded ? 'max-h-[70vh] overflow-y-auto' : 'max-h-[60vh]'}`}>
        {step === 'active' ? (
          <button
            type="button"
            onClick={() => setDetailsExpanded((v) => !v)}
            aria-expanded={detailsExpanded}
            aria-label={detailsExpanded ? 'Recolher detalhes da encomenda' : 'Expandir detalhes da encomenda'}
            className="mx-auto mb-1 flex items-center justify-center w-full py-1"
          >
            <span className="h-1 w-10 rounded-full bg-line" aria-hidden="true" />
          </button>
        ) : (
          <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
        )}
        {step === 'payment' ? (
          <div className="space-y-2.5">
            <p className="text-base font-semibold text-ink-900">Confirmar pagamento</p>
            <p className="text-xs text-ink-500">
              Cliente paga por <strong>{payLabel}</strong> direto a você.
            </p>
            <div className="rounded-panel border border-line bg-surface-alt px-3 py-3 text-center">
              <p className="text-xs text-ink-600 mb-0.5">Cliente deve pagar</p>
              <p className="text-2xl font-black text-brand-600">R$ {passengerAmount.toFixed(2)}</p>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={confirmPayment}
              className="w-full min-h-[44px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
            >
              <i className="ri-hand-coin-fill text-lg" aria-hidden="true" />
              Pagamento recebido
            </button>
          </div>
        ) : step === 'rating' ? (
          <div className="space-y-2.5">
            <p className="text-base font-semibold text-ink-900">Avalie o cliente</p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRatingValue(n)} className="min-w-[40px] min-h-[40px]">
                  <i className={`text-3xl ${n <= ratingValue ? 'ri-star-fill text-yellow-400' : 'ri-star-line text-ink-400'}`} />
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!ratingValue || submittingRating}
              onClick={submitRating}
              className="w-full min-h-[44px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50 text-sm"
            >
              Enviar e voltar
            </button>
            <button
              type="button"
              className="w-full min-h-[40px] rounded-panel border border-line text-ink-700 font-medium text-sm"
              onClick={async () => {
                try {
                  await skipCaptainParcelReview(parcel._id)
                } catch {
                  /* still leave */
                }
                setCaptainParcel(null)
                navigate('/captain-home')
              }}
            >
              Pular
            </button>
          </div>
        ) : (
          <>
            {parcel.user && (
              <PassengerIdentityCard
                user={parcel.user}
                showPhoto
                compact
                trailing={
                  <div className="text-right">
                    <p className="text-sm font-bold text-ink-900">R$ {passengerAmount.toFixed(2)}</p>
                    <p className="text-[10px] text-ink-400">{payLabel}</p>
                  </div>
                }
              />
            )}
            <div className="flex items-center gap-2 text-xs text-ink-600 min-w-0">
              <i className="ri-box-3-line text-brand-500 flex-shrink-0" aria-hidden="true" />
              <p className="font-semibold text-ink-900 truncate flex-1">{parcel.itemName}</p>
            </div>
            <div className="flex gap-3 text-[11px] text-ink-500">
              <span className="inline-flex items-center gap-1 min-w-0 flex-1 truncate">
                <i className="ri-map-pin-user-fill text-brand-500" aria-hidden="true" />
                <span className="truncate">{parcel.pickup?.split(',')[0]}</span>
              </span>
              <span className="inline-flex items-center gap-1 min-w-0 flex-1 truncate">
                <i className="ri-map-pin-2-fill text-danger-500" aria-hidden="true" />
                <span className="truncate">{parcel.destination?.split(',')[0]}</span>
              </span>
            </div>

            {parcel.recipient?.name && (
              <div className="rounded-panel border border-line bg-surface-alt px-2.5 py-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-ink-400 uppercase tracking-wide">Destinatário</p>
                  <p className="text-sm font-medium text-ink-900 truncate">
                    {parcel.recipient.name}
                    {parcel.recipient.phone ? ` · ${parcel.recipient.phone}` : ''}
                  </p>
                </div>
                {parcel.recipient.phone && (
                  <button
                    type="button"
                    onClick={() => {
                      const ok = openWhatsApp(
                        parcel.recipient.phone,
                        `Olá${parcel.recipient.name ? `, ${parcel.recipient.name}` : ''}! Sou o motorista da sua encomenda (${parcel.itemName || 'entrega'}) pela MoveCity.`,
                      )
                      if (!ok) addToast('Telefone do destinatário inválido', 'error')
                    }}
                    className="flex-shrink-0 min-h-[40px] min-w-[40px] rounded-panel bg-[#25D366] text-white flex items-center justify-center active:scale-[0.99]"
                    aria-label="WhatsApp do destinatário"
                  >
                    <i className="ri-whatsapp-fill text-xl" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            {detailsExpanded && (
              <div className="pt-2 border-t border-line space-y-2.5">
                <div className="flex items-start gap-2">
                  <i className="ri-map-pin-user-fill text-brand-500 text-sm mt-0.5 flex-shrink-0" aria-hidden="true"></i>
                  <div className="min-w-0">
                    <p className="text-[10px] text-ink-400 uppercase tracking-wide">Retirada</p>
                    <p className="text-xs text-ink-900">{parcel.pickup || '—'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <i className="ri-map-pin-2-fill text-danger-500 text-sm mt-0.5 flex-shrink-0" aria-hidden="true"></i>
                  <div className="min-w-0">
                    <p className="text-[10px] text-ink-400 uppercase tracking-wide">Destino</p>
                    <p className="text-xs text-ink-900">{parcel.destination || '—'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-[10px] text-ink-400 uppercase tracking-wide">Pagamento</p>
                    <p className="text-ink-900 font-medium">{payLabel}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-ink-400 uppercase tracking-wide">Valor</p>
                    <p className="text-ink-900 font-medium">R$ {passengerAmount.toFixed(2)}</p>
                  </div>
                  {parcel.weightKg != null && (
                    <div>
                      <p className="text-[10px] text-ink-400 uppercase tracking-wide">Peso</p>
                      <p className="text-ink-900 font-medium">{parcel.weightKg} kg</p>
                    </div>
                  )}
                  {parcel.size && (
                    <div>
                      <p className="text-[10px] text-ink-400 uppercase tracking-wide">Tamanho</p>
                      <p className="text-ink-900 font-medium capitalize">{parcel.size}</p>
                    </div>
                  )}
                </div>
                {parcel.sender?.name && (
                  <div>
                    <p className="text-[10px] text-ink-400 uppercase tracking-wide">Remetente</p>
                    <p className="text-xs text-ink-900">
                      {parcel.sender.name}
                      {parcel.sender.phone ? ` · ${parcel.sender.phone}` : ''}
                    </p>
                  </div>
                )}
              </div>
            )}

            {parcel.status === 'arrived_destination' ? (
              <div className="space-y-2">
                {parcel.requireDeliveryPin !== false && (
                  <>
                    <p className="text-xs font-medium text-ink-700">PIN do destinatário</p>
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      className="w-full text-center text-xl tracking-widest border border-line rounded-panel py-2.5"
                      placeholder="••••"
                    />
                  </>
                )}
                <button
                  type="button"
                  disabled={loading || (parcel.requireDeliveryPin !== false && pin.length < 4)}
                  onClick={confirmPin}
                  className="w-full min-h-[44px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50 text-sm"
                >
                  Confirmar entrega
                </button>
              </div>
            ) : NEXT_STATUS[parcel.status] ? (
              <button
                type="button"
                disabled={loading}
                onClick={advance}
                className="w-full min-h-[44px] rounded-panel bg-brand-500 text-white font-semibold disabled:opacity-50 text-sm"
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
