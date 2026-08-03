import React, { useState, useContext, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { SocketContext } from '@/contexts/SocketContext'
import { UserDataContext } from '@/contexts/UserContext'
import LiveTracking from '@/shared/components/LiveTracking'
import axios from 'axios'
import { vehicleImages, vehicleLabels } from '@/assets/vehicleAssets'
import { useToast } from '@/contexts/ToastContext'
import RideChat from '@/shared/components/RideChat'
import { submitReview } from '@/services/reviewApi'
import { getFriendlyErrorMessage } from '@/services/errorMessages'
import Card from '@/shared/components/ui/Card'
import DetailRow from '@/shared/components/ui/DetailRow'
import Button from '@/shared/components/ui/Button'
import { getAccessToken } from '@/services/session'
import { joinWithRetry } from '@/services/socketAuth'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'
import { enqueueOfflineAction } from '@/services/offlineQueue'

const Riding = () => {
    const location = useLocation()
    const { ride } = location.state || {}
    const { socket } = useContext(SocketContext)
    const { user } = useContext(UserDataContext)
    const navigate = useNavigate()
    const { addToast } = useToast()

    const [ showPayModal, setShowPayModal ] = useState(false)
    // 'payment' -> 'rating' -> 'done'. Corridas pagas pela carteira pulam direto pra 'rating'.
    const [ modalStep, setModalStep ] = useState('payment')
    const [ loading, setLoading ] = useState(false)
    const [ error, setError ] = useState('')
    const [ isChatOpen, setIsChatOpen ] = useState(false)
    const [ unreadCount, setUnreadCount ] = useState(0)
    const [ ratingValue, setRatingValue ] = useState(0)
    const [ ratingComment, setRatingComment ] = useState('')
    const [ submittingReview, setSubmittingReview ] = useState(false)

    useEffect(() => {
        if (!user || !user._id) return;

        const handleConnect = () => {
            // Auditoria PWA (2026-08-03, C2) + auditoria de regressão de push
            // (2026-08-03): joinWithRetry renova o token e tenta de novo se o atual já
            // estiver vencido — ver docs/plans/2026-08-03-auditoria-regressao-push.md.
            joinWithRetry(socket, { userId: user._id, userType: 'user' })
        }

        if (socket.connected) {
            handleConnect()
        }

        socket.on('connect', handleConnect)

        return () => {
            socket.off('connect', handleConnect)
        }
    }, [user])

    useEffect(() => {
        const handleRideEnded = () => {
            // Corrida paga pela carteira: o valor já foi debitado na solicitação, não
            // há nada a "acertar" — vai direto para a avaliação do motorista.
            if (ride?.paymentMethod === 'carteira') {
                setModalStep('rating')
                addToast('Viagem concluída! Que tal avaliar o motorista?', 'money', 6000)
            } else {
                setModalStep('payment')
                addToast(
                    `Viagem concluída! Pague R$${ride?.fare}`,
                    'money',
                    6000,
                    'Escolha sua forma de pagamento abaixo'
                )
            }
            setShowPayModal(true)
        }

        const handleReceiveMessage = (msg) => {
            if (!isChatOpen) {
                setUnreadCount(prev => prev + 1);
                addToast('Nova mensagem do motorista', 'info');

                // Play notification sound
                try {
                    const audio = new Audio('/sounds/new-ride.wav');
                    audio.play().catch(e => console.log(e));
                } catch (e) {}
            }
        }

        // P3.1 da auditoria de concorrência (2026-08-02): o backend já emitia este evento
        // quando o motorista confirmava o recebimento (rides/confirm-payment), mas nenhum
        // frontend escutava — o passageiro nunca sabia que o motorista tinha confirmado
        // do lado dele. Só um aviso; o passageiro já avança pro passo de avaliação
        // localmente assim que confirma "Já paguei", sem depender deste evento.
        const handlePaymentConfirmed = () => {
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
    }, [socket, ride, isChatOpen, addToast])

    // Reset unread count when chat opens
    useEffect(() => {
        if (isChatOpen) setUnreadCount(0);
    }, [isChatOpen])

    // Fetch initial unread count
    useEffect(() => {
        const fetchUnread = async () => {
            try {
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/chat/${ride?._id}`, {
                    headers: { Authorization: `Bearer ${getAccessToken('user')}` }
                });
                if (response.data.chat) {
                    setUnreadCount(response.data.chat.unreadUser || 0);
                }
            } catch (err) {}
        };
        if (ride?._id) fetchUnread();
    }, [ride])

    // O acerto (dinheiro ou pix) é feito diretamente com o motorista — o app não
    // processa nenhum pagamento. Este botão só avisa o motorista que o passageiro
    // confirma ter pago, para ele liberar a corrida do lado dele.
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
            // Auditoria PWA (2026-08-03, M3): mesma rede de segurança que já existia só
            // pro app do motorista — sem isto, uma queda de rede bem na hora de confirmar
            // "Já paguei" simplesmente perdia a ação.
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
        } catch (err) {
            // Não bloqueia o fim do fluxo por causa da avaliação — só avisa.
            addToast(getFriendlyErrorMessage(err, 'Não foi possível enviar a avaliação.'), 'error')
        } finally {
            setSubmittingReview(false)
            setModalStep('done')
        }
    }

    return (
        <div className='h-screen relative'>
            {/* Auditoria PWA (2026-08-03, M2): esta é a tela de corrida em andamento do
                passageiro — se o socket cair aqui, tudo ficava congelado sem nenhum
                aviso; as outras telas de tempo real já tinham o banner, esta não. */}
            <ConnectionBanner />
            <div className='fixed right-3 top-3 z-10 flex flex-col gap-2'>
                <Link
                    to='/home'
                    aria-label="Voltar para o início"
                    className='h-11 w-11 bg-surface flex items-center justify-center rounded-full shadow-raised text-ink-900'
                >
                    <i className="text-lg ri-home-5-line" aria-hidden="true"></i>
                </Link>
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
            </div>

            <div className='h-1/2'>
                <LiveTracking ride={ride} />
            </div>

            <div className='h-1/2 p-4 overflow-y-auto'>
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
                        title={ride?.destination?.split(',')[0]}
                        subtitle={ride?.destination}
                        className='px-3'
                    />
                    <DetailRow
                        icon="ri-currency-line"
                        title={`R$${ride?.fare}`}
                        subtitle="Valor Total"
                        className='px-3'
                    />
                </Card>

                {ride?.paymentMethod === 'carteira' ? (
                    <div className='flex flex-col gap-2 mt-4'>
                        <div className='w-full bg-brand-50 border border-brand-200 text-brand-700 font-semibold p-3 rounded-panel text-center flex items-center justify-center gap-2'>
                            <i className="ri-checkbox-circle-fill" aria-hidden="true"></i> Já pago pela carteira
                        </div>
                        <Button
                            variant='secondary'
                            onClick={() => { setModalStep('rating'); setShowPayModal(true) }}
                        >
                            Avaliar Motorista
                        </Button>
                    </div>
                ) : (
                    <Button
                        onClick={() => { setModalStep('payment'); setShowPayModal(true) }}
                        className='mt-4'
                    >
                        Acertar Pagamento
                    </Button>
                )}
            </div>

            {/* ── Modal pós-corrida: 'payment' -> 'rating' -> 'done' ──
                Fechamento unificado com o resto do app: alça no topo, não mais o ícone
                de X que só esse modal usava (item 13 da auditoria de UX). */}
            {showPayModal && (
                <div className='fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm'>
                    <div className='relative w-full max-w-md bg-surface rounded-t-3xl px-6 pt-8 pb-8 shadow-2xl animate-slide-up'>
                        {modalStep !== 'done' && (
                            <button
                                type="button"
                                onClick={() => setShowPayModal(false)}
                                aria-label="Fechar"
                                className='absolute right-1/2 translate-x-1/2 top-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400'
                            >
                                <i className="text-2xl ri-arrow-down-wide-line" aria-hidden="true"></i>
                            </button>
                        )}

                        {modalStep === 'payment' && (
                            <>
                                <h2 className='text-2xl font-bold text-ink-900 mb-6'>Acertar R${ride?.fare}</h2>

                                <div className='bg-amber-50 border border-amber-300 rounded-panel p-4 mb-6 flex gap-3 items-center'>
                                    <i className="ri-information-line text-amber-500 text-xl flex-shrink-0" aria-hidden="true"></i>
                                    <p className='text-sm text-amber-700'>
                                        Pague <strong>R${ride?.fare}</strong> {ride?.paymentMethod === 'pix' ? 'via Pix' : 'em dinheiro'} diretamente ao motorista. O app não processa este pagamento.
                                    </p>
                                </div>

                                {error && (
                                    <div className='bg-danger-50 border border-danger-500/30 rounded-panel p-3 mb-4 flex gap-2 items-center'>
                                        <i className="ri-error-warning-line text-danger-500" aria-hidden="true"></i>
                                        <p className='text-sm text-danger-600'>{error}</p>
                                    </div>
                                )}

                                <Button onClick={handleConfirmPayment} loading={loading}>
                                    Já paguei o motorista
                                </Button>
                            </>
                        )}

                        {modalStep === 'rating' && (
                            <>
                                <h2 className='text-2xl font-bold text-ink-900 mb-2'>Avalie a corrida</h2>
                                <p className='text-sm text-ink-400 mb-5'>
                                    Como foi sua viagem com {ride?.captain?.fullname?.firstname || 'o motorista'}?
                                </p>

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

                                <Button
                                    onClick={handleSubmitReview}
                                    disabled={!ratingValue}
                                    loading={submittingReview}
                                    className='mb-2'
                                >
                                    Enviar Avaliação
                                </Button>
                                <Button variant='ghost' onClick={() => setModalStep('done')}>
                                    Pular
                                </Button>
                            </>
                        )}

                        {modalStep === 'done' && (
                            <div className='flex flex-col items-center py-6'>
                                <div className='h-20 w-20 rounded-full bg-brand-50 flex items-center justify-center mb-4'>
                                    <i className="ri-checkbox-circle-fill text-5xl text-brand-500" aria-hidden="true"></i>
                                </div>
                                <h2 className='text-2xl font-bold text-ink-900 mb-1'>Tudo certo!</h2>
                                <p className='text-ink-400 mb-8'>Obrigado por viajar conosco 🙏</p>
                                <Button onClick={() => navigate('/home')}>
                                    Voltar ao Início
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <RideChat
                ride={ride}
                isOpen={isChatOpen}
                onClose={() => setIsChatOpen(false)}
                currentUserType="user"
            />
        </div>
    )
}

export default Riding
