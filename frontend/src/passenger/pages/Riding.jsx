import React, { useState, useContext, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { UserDataContext } from '@/passenger/contexts/UserContext'
import { RideContext } from '@/shared/contexts/RideContext'
import LiveTracking from '@/shared/components/LiveTracking'
import api from '@/shared/services/axios'
import { vehicleLabels } from '@/shared/assets/vehicleAssets'
import { useToast } from '@/shared/contexts/ToastContext'
import RideChat from '@/shared/components/RideChat'
import { submitReview } from '@/shared/services/reviewApi'
import { getFriendlyErrorMessage } from '@/shared/services/errorMessages'
import Card from '@/shared/components/ui/Card'
import DetailRow from '@/shared/components/ui/DetailRow'
import Button from '@/shared/components/ui/Button'
import DriverIdentityCard from '@/shared/components/DriverIdentityCard'
import { personName } from '@/shared/utils/identity'
import { getAccessToken } from '@/shared/services/session'
import { joinWithRetry } from '@/shared/services/socketAuth'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'
import { enqueueOfflineAction } from '@/shared/services/offlineQueue'
import { formatCurrencyBRL, formatDistanceLabel, formatDurationLabel, paymentMethodLabel, paymentStatusLabel as getPaymentStatusLabel } from '@/shared/utils/formatters'
import { getTripProgressMessage } from '@/passenger/utils/tripProgress'
import PassengerSafetyCenter from '@/passenger/components/PassengerSafetyCenter'
import {
    calculateFareDifference,
    describeLiveFareFreshness,
    normalizeLiveFare,
} from '@/passenger/utils/liveFarePresentation'

const shortAddress = (address) => {
    if (!address || typeof address !== 'string') return '—'
    return address.split(',')[0]
}

const Riding = () => {
    const location = useLocation()
    const { socket } = useContext(SocketContext)
    const { user } = useContext(UserDataContext)
    const { userRide, setUserRide, syncUserRide, clearUserRide } = useContext(RideContext)
    const navigate = useNavigate()
    const { addToast } = useToast()

    const [ ride, setRideLocal ] = useState(location.state?.ride || userRide || null)
    const [ rehydrating, setRehydrating ] = useState(!(location.state?.ride || userRide))

    useEffect(() => {
        if (ride) {
            setRehydrating(false)
            return
        }

        let cancelled = false
        syncUserRide().then((restored) => {
            if (cancelled) return
            if (restored === null) {
                addToast('Nenhuma corrida em andamento encontrada.', 'info')
                navigate('/home', { state: { clearTrip: true }, replace: true })
                return
            }
            // finished chega via location.state (pós-corrida); /rides/current não devolve finished.
            if (restored && restored.status !== 'started') {
                navigate('/home')
                return
            }
            if (restored) {
                setRideLocal(restored)
                setRehydrating(false)
            }
        })

        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (userRide && (!ride || userRide._id === ride._id)) {
            setRideLocal(userRide)
            setRehydrating(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userRide])

    const [ showPayModal, setShowPayModal ] = useState(
        Boolean(location.state?.ride?.status === 'finished' || location.state?.openPostRide)
    )
    // 'summary' -> 'payment' -> 'rating' -> 'done'. Carteira pula payment.
    const [ modalStep, setModalStep ] = useState('summary')
    const [ loading, setLoading ] = useState(false)
    const [ error, setError ] = useState('')
    const [ isChatOpen, setIsChatOpen ] = useState(false)
    const [ unreadCount, setUnreadCount ] = useState(0)
    const [ ratingValue, setRatingValue ] = useState(0)
    const [ ratingComment, setRatingComment ] = useState('')
    const [ submittingReview, setSubmittingReview ] = useState(false)
    const [ alreadyReviewed, setAlreadyReviewed ] = useState(false)
    const [ tripProgress, setTripProgress ] = useState({ progress: 0, remainingKm: null, etaMinutes: null })
    const [ liveFare, setLiveFare ] = useState(() => normalizeLiveFare(
        location.state?.ride?.liveFare || userRide?.liveFare
    ))
    const [ fareClock, setFareClock ] = useState(Date.now())
    const [ online, setOnline ] = useState(() => navigator.onLine)
    const [ captainLocation, setCaptainLocation ] = useState(null)

    const isFinished = ride?.status === 'finished'
    const rideAmount = isFinished
        ? (ride?.finalPrice ?? ride?.fare)
        : (liveFare?.amount ?? ride?.finalPrice ?? ride?.fare)
    const rideAmountLabel = isFinished
        ? 'Valor final'
        : (liveFare?.amount != null ? 'Valor atual' : 'Estimativa original')
    const paymentStatusLabel = getPaymentStatusLabel(ride?.paymentStatus, ride?.paymentMethod)
    const fareDifference = calculateFareDifference(rideAmount, ride?.fare)
    const fareFreshness = describeLiveFareFreshness({
        updatedAt: liveFare?.calculatedAt,
        now: fareClock,
        online,
    })

    useEffect(() => {
        const interval = setInterval(() => setFareClock(Date.now()), 1000)
        const handleOnline = () => setOnline(true)
        const handleOffline = () => setOnline(false)
        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)
        return () => {
            clearInterval(interval)
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [])

    useEffect(() => {
        const next = normalizeLiveFare(ride?.liveFare)
        if (next) setLiveFare(next)
    }, [ride?.liveFare])

    useEffect(() => {
        if (ride?.status !== 'started') return undefined

        let cancelled = false
        const reconcile = async () => {
            const restored = await syncUserRide()
            if (cancelled) return
            const snapshot = normalizeLiveFare(restored?.liveFare)
            if (snapshot) setLiveFare(snapshot)
        }

        // Atualiza também com o carro parado: o preço pode variar pelo tempo mesmo sem
        // um novo ponto de GPS. Reconexão/retorno do app continuam cobertos pelo contexto.
        reconcile()
        const interval = setInterval(reconcile, 20_000)
        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [ride?._id, ride?.status, syncUserRide])

    const finishAndGoHome = useCallback(() => {
        clearUserRide?.()
        setRideLocal(null)
        setShowPayModal(false)
        navigate('/home', { state: { clearTrip: true }, replace: true })
    }, [clearUserRide, navigate])

    const minimizeActiveRide = useCallback(() => {
        // Mantém RideContext intacto. A Home exibe o atalho persistente para voltar e
        // o backend continua sendo reconciliado em segundo plano.
        navigate('/home', { replace: true, state: { minimizedRideId: ride?._id } })
    }, [navigate, ride?._id])

    const openPostRideFlow = useCallback((endedRide) => {
        const data = endedRide || ride
        if (!data?._id) return
        setRideLocal(data)
        setUserRide(data)
        setError('')
        setModalStep('summary')
        setShowPayModal(true)
        addToast('Sua corrida foi concluída.', 'success', 5000)
    }, [ride, setUserRide, addToast])

    useEffect(() => {
        if (!user || !user._id) return;

        const handleConnect = () => {
            joinWithRetry(socket, { userId: user._id, userType: 'user' })
            syncUserRide()
        }

        if (socket.connected) {
            handleConnect()
        }

        socket.on('connect', handleConnect)

        return () => {
            socket.off('connect', handleConnect)
        }
    }, [user, socket, syncUserRide])

    useEffect(() => {
        if (!socket) return undefined

        const handleLocationUpdate = (payload) => {
            if (payload?.rideId && ride?._id && String(payload.rideId) !== String(ride._id)) return

            if (typeof payload?.liveFare?.amount === 'number') {
                setLiveFare(normalizeLiveFare(payload.liveFare))
            }
            if (payload?.ltd != null && payload?.lng != null) {
                setCaptainLocation({ lat: payload.ltd, lng: payload.lng })
            }
            if (typeof payload?.actualDistance === 'number') {
                setRideLocal((previous) => previous
                    ? { ...previous, actualDistance: payload.actualDistance }
                    : previous)
            }
        }

        socket.on('captain-location-updated', handleLocationUpdate)
        return () => socket.off('captain-location-updated', handleLocationUpdate)
    }, [socket, ride?._id])

    useEffect(() => {
        const handleRideEnded = (endedRide) => {
            openPostRideFlow(endedRide)
            const amount = endedRide?.finalPrice ?? endedRide?.fare ?? ride?.fare
            if (endedRide?.paymentMethod === 'carteira' || ride?.paymentMethod === 'carteira') {
                addToast('Viagem concluída! Que tal avaliar o motorista?', 'money', 6000)
            } else if (amount != null) {
                addToast(`Viagem concluída! Valor: ${formatCurrencyBRL(amount)}`, 'money', 6000)
            }
        }

        const handleReceiveMessage = () => {
            if (!isChatOpen) {
                setUnreadCount(prev => prev + 1);
                addToast('Nova mensagem do motorista', 'info');
                try {
                    const audio = new Audio('/sounds/new-ride.wav');
                    audio.play().catch(() => {});
                } catch { /* ignore */ }
            }
        }

        const handlePaymentConfirmed = (updated) => {
            if (updated?._id) {
                setRideLocal((prev) => (prev && prev._id === updated._id ? { ...prev, ...updated } : prev))
                setUserRide((prev) => (prev && prev._id === updated._id ? { ...prev, ...updated } : prev))
            }
            addToast('O motorista confirmou o recebimento do pagamento.', 'success')
        }

        socket.on('ride-ended', handleRideEnded)
        socket.on('receive-message', handleReceiveMessage)
        socket.on('payment-confirmed', handlePaymentConfirmed)

        return () => {
            socket.off('ride-ended', handleRideEnded)
            socket.off('receive-message', handleReceiveMessage)
            socket.off('payment-confirmed', handlePaymentConfirmed)
        }
    }, [socket, ride, isChatOpen, addToast, openPostRideFlow, setUserRide])

    // Abre pós-corrida se a tela já montou com status finished (ex.: veio da Home).
    useEffect(() => {
        if (ride?.status === 'finished' && !showPayModal) {
            setModalStep('summary')
            setShowPayModal(true)
        }
    }, [ride?.status, showPayModal])

    useEffect(() => {
        if (isChatOpen) setUnreadCount(0);
    }, [isChatOpen])

    useEffect(() => {
        const fetchUnread = async () => {
            try {
                const response = await api.get(`${import.meta.env.VITE_BASE_URL}/chat/${ride?._id}`, {
                    headers: { Authorization: `Bearer ${getAccessToken('user')}` }
                });
                if (response.data.chat) {
                    setUnreadCount(response.data.chat.unreadUser || 0);
                }
            } catch { /* ignore */ }
        };
        if (ride?._id && !isFinished) fetchUnread();
    }, [ride?._id, isFinished])

    async function handleConfirmPayment() {
        setError('')
        setLoading(true)
        try {
            await api.post(`${import.meta.env.VITE_BASE_URL}/rides/pay`, {
                rideId: ride._id
            }, {
                headers: { Authorization: `Bearer ${getAccessToken('user')}` }
            })
            setModalStep('rating')
        } catch (err) {
            if (!navigator.onLine || err.message === 'Network Error') {
                enqueueOfflineAction({
                    type: 'pay-ride',
                    rideId: ride._id,
                    payload: { rideId: ride._id }
                }).catch(e => console.error(e));
                addToast('Sem conexão — a confirmação será enviada assim que a internet voltar.', 'info', 6000);
                setModalStep('rating')
            } else {
                setError(getFriendlyErrorMessage(err, 'Não foi possível confirmar. Tente novamente.'))
            }
        } finally {
            setLoading(false)
        }
    }

    async function handleSubmitReview() {
        if (!ratingValue) return
        setError('')
        setSubmittingReview(true)
        try {
            await submitReview({ rideId: ride._id, rating: ratingValue, comment: ratingComment })
            setAlreadyReviewed(true)
            setModalStep('done')
        } catch (err) {
            if (err.response?.status === 409) {
                setAlreadyReviewed(true)
                addToast('Você já avaliou esta corrida.', 'info')
                setModalStep('done')
            } else {
                addToast(getFriendlyErrorMessage(err, 'Não foi possível enviar a avaliação.'), 'error')
                setModalStep('done')
            }
        } finally {
            setSubmittingReview(false)
        }
    }

    const continueFromSummary = () => {
        if (ride?.paymentMethod === 'carteira' || ride?.paymentStatus === 'paid') {
            setModalStep('rating')
        } else {
            setModalStep('payment')
        }
    }

    if (rehydrating) {
        return (
            <div className='h-screen flex items-center justify-center bg-surface-alt'>
                <ConnectionBanner />
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600"></div>
            </div>
        )
    }

    const distanceLabel = formatDistanceLabel(ride?.actualDistance)
    const durationLabel = formatDurationLabel(ride?.actualTime)
    const captainName = personName(ride?.captain) || null
    const progressMessage = getTripProgressMessage(tripProgress)

    return (
        <div className='h-[100dvh] relative flex flex-col bg-surface overflow-hidden'>
            <ConnectionBanner />
            <div className='absolute right-3 top-3 z-10 flex flex-col gap-2'>
                <button
                    type="button"
                    onClick={isFinished ? finishAndGoHome : minimizeActiveRide}
                    aria-label={isFinished ? 'Voltar para o início' : 'Minimizar corrida'}
                    className='h-11 w-11 bg-surface flex items-center justify-center rounded-full shadow-raised text-ink-900'
                >
                    <i className={`text-lg ${isFinished ? 'ri-home-5-line' : 'ri-subtract-line'}`} aria-hidden="true"></i>
                </button>
                {!isFinished && (
                    <button
                        type="button"
                        onClick={() => setIsChatOpen(true)}
                        aria-label="Abrir chat com o motorista"
                        className='h-11 w-11 bg-surface flex items-center justify-center rounded-full shadow-raised relative text-ink-900'
                    >
                        <i className="text-lg ri-chat-3-line" aria-hidden="true"></i>
                        {unreadCount > 0 && (
                            <span className='absolute -top-1 -right-1 bg-danger-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold'>
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>
                )}
            </div>

            <div className='flex-1 min-h-0 relative'>
                <LiveTracking
                    ride={ride}
                    clearTrip={isFinished}
                    onTripProgress={setTripProgress}
                    onCaptainLocation={setCaptainLocation}
                />
            </div>

            <div className='flex-shrink-0 px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] rounded-t-3xl -mt-3 relative z-10 bg-surface shadow-floating border-t border-line'>
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" aria-hidden="true" />

                <DriverIdentityCard
                    captain={ride?.captain}
                    vehicleTypeFallback={ride?.vehicleType}
                    compact
                />

                {!isFinished && (
                    <div
                        className='mt-3 rounded-panel border border-brand-200 bg-brand-50 px-3 py-2 flex items-center justify-between gap-3'
                        aria-live='polite'
                    >
                        <div className='min-w-0'>
                            <p className='text-[11px] font-semibold uppercase tracking-wide text-brand-700'>Valor atual da corrida</p>
                            <p className={`text-[11px] truncate ${fareFreshness.stale ? 'text-amber-700' : 'text-ink-500'}`}>
                                {fareFreshness.label}
                            </p>
                            <p className='text-[11px] text-ink-400 mt-0.5'>
                                Estimativa inicial: {ride?.fare != null ? formatCurrencyBRL(ride.fare) : '—'}
                                {fareDifference != null && Math.abs(fareDifference) >= 0.01
                                    ? ` · ${fareDifference > 0 ? '+' : '-'}${formatCurrencyBRL(Math.abs(fareDifference))}`
                                    : ''}
                            </p>
                        </div>
                        <p className='text-xl font-bold tabular-nums text-brand-700 flex-shrink-0'>
                            {rideAmount != null ? formatCurrencyBRL(rideAmount) : 'Calculando…'}
                        </p>
                    </div>
                )}

                {!isFinished && (
                    <div className='mt-3 rounded-panel border border-brand-100 bg-brand-50 px-3 py-2.5 flex gap-3' aria-live='polite'>
                        <div className='h-9 w-9 rounded-full bg-brand-500 text-white flex flex-shrink-0 items-center justify-center'>
                            <i className={progressMessage.icon} aria-hidden='true' />
                        </div>
                        <div className='min-w-0'>
                            <p className='text-sm font-bold text-ink-900'>{progressMessage.title}</p>
                            <p className='mt-0.5 text-xs leading-relaxed text-ink-600'>{progressMessage.text}</p>
                        </div>
                    </div>
                )}

                {!isFinished && (tripProgress.remainingKm != null || tripProgress.etaMinutes != null) && (
                    <div className='mt-2.5 grid grid-cols-2 gap-2' aria-label='Progresso da viagem'>
                        <div className='rounded-panel bg-surface-alt px-3 py-2'>
                            <p className='text-[11px] text-ink-400'>Distância restante</p>
                            <p className='text-sm font-bold tabular-nums text-ink-900'>{tripProgress.remainingKm?.toFixed(1) ?? '—'} km</p>
                        </div>
                        <div className='rounded-panel bg-surface-alt px-3 py-2'>
                            <p className='text-[11px] text-ink-400'>Tempo estimado</p>
                            <p className='text-sm font-bold tabular-nums text-ink-900'>{tripProgress.etaMinutes ? `${tripProgress.etaMinutes} min` : 'Calculando…'}</p>
                        </div>
                    </div>
                )}

                <div className='mt-2.5 flex items-center gap-3 text-xs text-ink-600'>
                    <span className='inline-flex items-center gap-1 min-w-0 flex-1 truncate'>
                        <i className="ri-map-pin-2-fill text-danger-500 flex-shrink-0" aria-hidden="true" />
                        <span className='truncate font-medium text-ink-900'>{shortAddress(ride?.destination)}</span>
                    </span>
                    {(distanceLabel || durationLabel) && (
                        <span className='flex-shrink-0 tabular-nums text-ink-500'>
                            {[distanceLabel, durationLabel].filter(Boolean).join(' · ')}
                        </span>
                    )}
                </div>

                {!isFinished && (
                    <div className='mt-2.5 flex justify-center'>
                        <PassengerSafetyCenter ride={ride} captainLocation={captainLocation} />
                    </div>
                )}

                {isFinished ? (
                    <Button
                        onClick={() => { setModalStep('summary'); setShowPayModal(true) }}
                        className='mt-3 !min-h-[44px] !text-sm'
                    >
                        Ver resumo da corrida
                    </Button>
                ) : ride?.paymentMethod === 'carteira' ? (
                    <div className='mt-3 w-full bg-brand-50 border border-brand-200 text-brand-700 font-semibold py-2 px-3 rounded-panel text-center text-sm flex items-center justify-center gap-2'>
                        <i className="ri-checkbox-circle-fill" aria-hidden="true"></i> Pago pela carteira
                    </div>
                ) : (
                    <p className='text-xs text-ink-400 mt-3 text-center'>
                        Ao finalizar, você verá o resumo da corrida.
                    </p>
                )}
            </div>

            {showPayModal && (
                <div className='fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm'>
                    <div className='relative w-full max-w-md bg-surface rounded-t-3xl px-6 pt-8 pb-8 shadow-2xl animate-slide-up max-h-[90dvh] overflow-y-auto'>
                        {modalStep !== 'done' && (
                            <button
                                type="button"
                                onClick={finishAndGoHome}
                                aria-label="Fechar e voltar ao início"
                                className='absolute right-1/2 translate-x-1/2 top-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400'
                            >
                                <i className="text-2xl ri-arrow-down-wide-line" aria-hidden="true"></i>
                            </button>
                        )}

                        {modalStep === 'summary' && (
                            <>
                                <h2 className='text-2xl font-bold text-ink-900 mb-1'>Corrida concluída</h2>
                                <p className='text-sm text-ink-400 mb-5'>Sua corrida foi concluída.</p>

                                <Card padding='p-1' className='divide-y divide-line mb-4'>
                                    <DetailRow
                                        icon="ri-map-pin-user-fill"
                                        iconColor="text-brand-500"
                                        title="Origem"
                                        subtitle={ride?.pickup || '—'}
                                        className='px-3'
                                    />
                                    <DetailRow
                                        icon="ri-map-pin-2-fill"
                                        iconColor="text-danger-500"
                                        title="Destino"
                                        subtitle={ride?.destination || '—'}
                                        className='px-3'
                                    />
                                    <DetailRow
                                        icon="ri-currency-line"
                                        title={formatCurrencyBRL(rideAmount)}
                                        subtitle={rideAmountLabel}
                                        className='px-3'
                                    />
                                    <DetailRow
                                        icon="ri-bank-card-line"
                                        title={paymentMethodLabel(ride?.paymentMethod)}
                                        subtitle={paymentStatusLabel || 'Forma de pagamento'}
                                        className='px-3'
                                    />
                                    {captainName && (
                                        <DetailRow
                                            icon="ri-user-star-line"
                                            title={captainName}
                                            subtitle={[
                                                ride?.captain?.vehicle?.plate,
                                                vehicleLabels[ride?.captain?.vehicle?.vehicleType] || ride?.vehicleType,
                                            ].filter(Boolean).join(' · ') || 'Motorista'}
                                            className='px-3'
                                        />
                                    )}
                                    {(distanceLabel || durationLabel) && (
                                        <DetailRow
                                            icon="ri-route-line"
                                            title={[distanceLabel, durationLabel].filter(Boolean).join(' · ')}
                                            subtitle="Distância e duração"
                                            className='px-3'
                                        />
                                    )}
                                </Card>

                                <Button onClick={continueFromSummary}>
                                    Continuar
                                </Button>
                            </>
                        )}

                        {modalStep === 'payment' && (
                            <>
                                <h2 className='text-2xl font-bold text-ink-900 mb-6'>
                                    Acertar {formatCurrencyBRL(rideAmount)}
                                </h2>

                                <div className='bg-amber-50 border border-amber-300 rounded-panel p-4 mb-6 flex gap-3 items-center'>
                                    <i className="ri-information-line text-amber-500 text-xl flex-shrink-0" aria-hidden="true"></i>
                                    <p className='text-sm text-amber-700'>
                                        Pague <strong>{formatCurrencyBRL(rideAmount)}</strong> {ride?.paymentMethod === 'pix' ? 'via Pix' : 'em dinheiro'} diretamente ao motorista. O app não processa este pagamento.
                                    </p>
                                </div>

                                {paymentStatusLabel && (
                                    <p className='text-sm text-ink-500 mb-4 text-center'>{paymentStatusLabel}</p>
                                )}

                                {error && (
                                    <div className='bg-danger-50 border border-danger-500/30 rounded-panel p-3 mb-4 flex gap-2 items-center'>
                                        <i className="ri-error-warning-line text-danger-500" aria-hidden="true"></i>
                                        <p className='text-sm text-danger-600'>{error}</p>
                                    </div>
                                )}

                                <Button onClick={handleConfirmPayment} loading={loading}>
                                    Já paguei o motorista
                                </Button>
                                <Button variant='ghost' className='mt-2' onClick={() => setModalStep('rating')}>
                                    Pular
                                </Button>
                            </>
                        )}

                        {modalStep === 'rating' && (
                            <>
                                <h2 className='text-2xl font-bold text-ink-900 mb-2'>Como foi sua viagem?</h2>
                                <p className='text-sm text-ink-400 mb-5'>
                                    Avalie {ride?.captain?.fullname?.firstname || 'o motorista'}
                                </p>

                                {alreadyReviewed ? (
                                    <p className='text-sm text-brand-600 text-center mb-5'>Você já avaliou esta corrida.</p>
                                ) : (
                                    <>
                                        <div className='flex justify-center gap-2 mb-5'>
                                            {[1, 2, 3, 4, 5].map(star => (
                                                <button
                                                    key={star}
                                                    type='button'
                                                    onClick={() => setRatingValue(star)}
                                                    aria-label={`${star} ${star === 1 ? 'estrela' : 'estrelas'}`}
                                                    aria-pressed={star <= ratingValue}
                                                    className='p-1 min-w-[44px] min-h-[44px] flex items-center justify-center'
                                                >
                                                    <i className={`text-4xl ${star <= ratingValue ? 'ri-star-fill text-amber-400' : 'ri-star-line text-ink-400/40'}`} aria-hidden="true"></i>
                                                </button>
                                            ))}
                                        </div>

                                        <textarea
                                            value={ratingComment}
                                            onChange={e => setRatingComment(e.target.value)}
                                            placeholder='Deixe um comentário (opcional)'
                                            rows={3}
                                            className='w-full border border-line rounded-panel px-4 py-3 text-base text-ink-900 placeholder-ink-400 focus:border-brand-500 focus:outline-none mb-5 resize-none'
                                        />
                                    </>
                                )}

                                {!alreadyReviewed && (
                                    <Button
                                        onClick={handleSubmitReview}
                                        disabled={!ratingValue}
                                        loading={submittingReview}
                                        className='mb-2'
                                    >
                                        Enviar Avaliação
                                    </Button>
                                )}
                                <Button variant='ghost' onClick={() => setModalStep('done')}>
                                    {alreadyReviewed ? 'Continuar' : 'Pular'}
                                </Button>
                            </>
                        )}

                        {modalStep === 'done' && (
                            <div className='flex flex-col items-center py-6'>
                                <div className='h-20 w-20 rounded-full bg-brand-50 flex items-center justify-center mb-4'>
                                    <i className="ri-checkbox-circle-fill text-5xl text-brand-500" aria-hidden="true"></i>
                                </div>
                                <h2 className='text-2xl font-bold text-ink-900 mb-1'>Tudo certo!</h2>
                                <p className='text-ink-400 mb-8 text-center'>Obrigado por viajar conosco. Você já pode pedir uma nova corrida.</p>
                                <Button onClick={finishAndGoHome}>
                                    Voltar para início
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {!isFinished && (
                <RideChat
                    ride={ride}
                    isOpen={isChatOpen}
                    onClose={() => setIsChatOpen(false)}
                    currentUserType="user"
                />
            )}
        </div>
    )
}

export default Riding
