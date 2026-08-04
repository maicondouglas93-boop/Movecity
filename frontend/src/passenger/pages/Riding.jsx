import React, { useState, useContext, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { UserDataContext } from '@/passenger/contexts/UserContext'
import { RideContext } from '@/shared/contexts/RideContext'
import LiveTracking from '@/shared/components/LiveTracking'
import axios from 'axios'
import { vehicleImages, vehicleLabels } from '@/shared/assets/vehicleAssets'
import { useToast } from '@/shared/contexts/ToastContext'
import RideChat from '@/shared/components/RideChat'
import { submitReview } from '@/shared/services/reviewApi'
import { getFriendlyErrorMessage } from '@/shared/services/errorMessages'
import Card from '@/shared/components/ui/Card'
import DetailRow from '@/shared/components/ui/DetailRow'
import Button from '@/shared/components/ui/Button'
import { getAccessToken } from '@/shared/services/session'
import { joinWithRetry } from '@/shared/services/socketAuth'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'
import { enqueueOfflineAction } from '@/shared/services/offlineQueue'

const paymentLabel = (method) => {
    if (method === 'pix') return 'Pix'
    if (method === 'carteira') return 'Carteira'
    if (method === 'card' || method === 'cartao') return 'Cartão'
    if (method === 'cash' || method === 'dinheiro') return 'Dinheiro'
    return method || '—'
}

const formatMoney = (value) => {
    if (value == null || Number.isNaN(Number(value))) return '—'
    return `R$${Number(value).toFixed(2)}`
}

const formatDistance = (meters) => {
    if (meters == null || meters <= 0) return null
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
    return `${Math.round(meters)} m`
}

const formatDuration = (seconds) => {
    if (seconds == null || seconds <= 0) return null
    const mins = Math.round(seconds / 60)
    if (mins < 60) return `${mins} min`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `${h} h ${m} min` : `${h} h`
}

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

    const rideAmount = ride?.finalPrice ?? ride?.fare
    const isFinished = ride?.status === 'finished'
    const paymentStatusLabel = (() => {
        if (ride?.paymentMethod === 'carteira') return 'Pago pela carteira'
        if (ride?.paymentStatus === 'paid') return 'Pagamento confirmado'
        if (ride?.paymentStatus === 'pending') return 'Pagamento em processamento'
        return null
    })()

    const goHomeClean = useCallback(() => {
        clearUserRide?.()
        setRideLocal(null)
        setShowPayModal(false)
        navigate('/home', { state: { clearTrip: true }, replace: true })
    }, [clearUserRide, navigate])

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
        }

        if (socket.connected) {
            handleConnect()
        }

        socket.on('connect', handleConnect)

        return () => {
            socket.off('connect', handleConnect)
        }
    }, [user, socket])

    useEffect(() => {
        const handleRideEnded = (endedRide) => {
            openPostRideFlow(endedRide)
            const amount = endedRide?.finalPrice ?? endedRide?.fare ?? ride?.fare
            if (endedRide?.paymentMethod === 'carteira' || ride?.paymentMethod === 'carteira') {
                addToast('Viagem concluída! Que tal avaliar o motorista?', 'money', 6000)
            } else if (amount != null) {
                addToast(`Viagem concluída! Valor: ${formatMoney(amount)}`, 'money', 6000)
            }
        }

        const handleReceiveMessage = () => {
            if (!isChatOpen) {
                setUnreadCount(prev => prev + 1);
                addToast('Nova mensagem do motorista', 'info');
                try {
                    const audio = new Audio('/sounds/new-ride.wav');
                    audio.play().catch(() => {});
                } catch (_) { /* ignore */ }
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
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/chat/${ride?._id}`, {
                    headers: { Authorization: `Bearer ${getAccessToken('user')}` }
                });
                if (response.data.chat) {
                    setUnreadCount(response.data.chat.unreadUser || 0);
                }
            } catch (_) { /* ignore */ }
        };
        if (ride?._id && !isFinished) fetchUnread();
    }, [ride?._id, isFinished])

    async function handleConfirmPayment() {
        setError('')
        setLoading(true)
        try {
            await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/pay`, {
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

    const distanceLabel = formatDistance(ride?.actualDistance)
    const durationLabel = formatDuration(ride?.actualTime)
    const captainName = ride?.captain?.fullname?.firstname
        ? `${ride.captain.fullname.firstname}${ride.captain.fullname.lastname ? ` ${ride.captain.fullname.lastname}` : ''}`
        : null

    return (
        <div className='h-screen relative'>
            <ConnectionBanner />
            <div className='fixed right-3 top-3 z-10 flex flex-col gap-2'>
                <button
                    type="button"
                    onClick={goHomeClean}
                    aria-label="Voltar para o início"
                    className='h-11 w-11 bg-surface flex items-center justify-center rounded-full shadow-raised text-ink-900'
                >
                    <i className="text-lg ri-home-5-line" aria-hidden="true"></i>
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

            <div className='h-1/2'>
                <LiveTracking ride={ride} clearTrip={isFinished} />
            </div>

            <div className='h-1/2 p-4 overflow-y-auto overscroll-y-contain'>
                <div className='flex items-center justify-between'>
                    <div>
                        <img className='h-14 object-contain' src={vehicleImages[ride?.captain?.vehicle?.vehicleType] || vehicleImages.car} alt={ride?.captain?.vehicle?.vehicleType} width="1024" height="1024" loading="lazy" />
                        <p className='text-xs text-center text-ink-400 mt-0.5 font-medium'>{vehicleLabels[ride?.captain?.vehicle?.vehicleType] || 'MoveGo'}</p>
                    </div>
                    <div className='text-right'>
                        <h2 className='text-lg font-medium capitalize text-ink-900'>{ride?.captain?.fullname?.firstname}</h2>
                        <h4 className='text-xl font-semibold -mt-1 -mb-1 text-ink-900'>{ride?.captain?.vehicle?.plate}</h4>
                        <p className='text-sm text-ink-400 capitalize'>{ride?.captain?.vehicle?.color} {ride?.captain?.vehicle?.vehicleType}</p>
                    </div>
                </div>

                <Card padding='p-1' className='divide-y divide-line mt-5'>
                    <DetailRow
                        icon="ri-map-pin-2-fill"
                        iconColor="text-danger-500"
                        title={shortAddress(ride?.destination)}
                        subtitle={ride?.destination}
                        className='px-3'
                    />
                    <DetailRow
                        icon="ri-currency-line"
                        title={formatMoney(rideAmount)}
                        subtitle={isFinished ? 'Valor final' : 'Valor estimado'}
                        className='px-3'
                    />
                </Card>

                {isFinished ? (
                    <Button
                        onClick={() => { setModalStep('summary'); setShowPayModal(true) }}
                        className='mt-4'
                    >
                        Ver resumo da corrida
                    </Button>
                ) : ride?.paymentMethod === 'carteira' ? (
                    <div className='flex flex-col gap-2 mt-4'>
                        <div className='w-full bg-brand-50 border border-brand-200 text-brand-700 font-semibold p-3 rounded-panel text-center flex items-center justify-center gap-2'>
                            <i className="ri-checkbox-circle-fill" aria-hidden="true"></i> Já pago pela carteira
                        </div>
                    </div>
                ) : (
                    <p className='text-sm text-ink-400 mt-4 text-center'>
                        Ao finalizar, o motorista encerrará a corrida e você verá o resumo.
                    </p>
                )}
            </div>

            {showPayModal && (
                <div className='fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm'>
                    <div className='relative w-full max-w-md bg-surface rounded-t-3xl px-6 pt-8 pb-8 shadow-2xl animate-slide-up max-h-[90dvh] overflow-y-auto'>
                        {modalStep !== 'done' && (
                            <button
                                type="button"
                                onClick={goHomeClean}
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
                                        title={formatMoney(rideAmount)}
                                        subtitle="Valor"
                                        className='px-3'
                                    />
                                    <DetailRow
                                        icon="ri-bank-card-line"
                                        title={paymentLabel(ride?.paymentMethod)}
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
                                    Acertar {formatMoney(rideAmount)}
                                </h2>

                                <div className='bg-amber-50 border border-amber-300 rounded-panel p-4 mb-6 flex gap-3 items-center'>
                                    <i className="ri-information-line text-amber-500 text-xl flex-shrink-0" aria-hidden="true"></i>
                                    <p className='text-sm text-amber-700'>
                                        Pague <strong>{formatMoney(rideAmount)}</strong> {ride?.paymentMethod === 'pix' ? 'via Pix' : 'em dinheiro'} diretamente ao motorista. O app não processa este pagamento.
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
                                <Button onClick={goHomeClean}>
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
