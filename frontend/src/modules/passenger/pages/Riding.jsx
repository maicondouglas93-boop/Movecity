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
            socket.emit("join", { userType: "user", userId: user._id })
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
        
        socket.on('ride-ended', handleRideEnded)
        socket.on('receive-message', handleReceiveMessage)
        
        return () => {
            socket.off('ride-ended', handleRideEnded)
            socket.off('receive-message', handleReceiveMessage)
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
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
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
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            })
            setModalStep('rating')
        } catch (err) {
            setError(err.response?.data?.message || 'Não foi possível confirmar. Tente novamente.')
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
            addToast(err.response?.data?.message || 'Não foi possível enviar a avaliação.', 'error')
        } finally {
            setSubmittingReview(false)
            setModalStep('done')
        }
    }

    return (
        <div className='h-screen relative'>
            <div className='fixed right-2 top-2 z-10 flex flex-col gap-2'>
                <Link to='/home' className='h-10 w-10 bg-white flex items-center justify-center rounded-full shadow'>
                    <i className="text-lg font-medium ri-home-5-line"></i>
                </Link>
                <button 
                    onClick={() => setIsChatOpen(true)}
                    className='h-10 w-10 bg-white flex items-center justify-center rounded-full shadow relative'
                >
                    <i className="text-lg font-medium ri-chat-3-line"></i>
                    {unreadCount > 0 && (
                        <span className='absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold'>
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
                        <img className='h-14 object-contain' src={vehicleImages[ride?.captain?.vehicle?.vehicleType] || vehicleImages.car} alt={ride?.captain?.vehicle?.vehicleType} />
                        <p className='text-xs text-center text-gray-500 mt-0.5 font-medium'>{vehicleLabels[ride?.captain?.vehicle?.vehicleType] || 'MoveGo'}</p>
                    </div>
                    <div className='text-right'>
                        <h2 className='text-lg font-medium capitalize'>{ride?.captain?.fullname?.firstname}</h2>
                        <h4 className='text-xl font-semibold -mt-1 -mb-1'>{ride?.captain?.vehicle?.plate}</h4>
                        <p className='text-sm text-gray-600 capitalize'>{ride?.captain?.vehicle?.color} {ride?.captain?.vehicle?.vehicleType}</p>
                    </div>
                </div>

                <div className='flex gap-2 justify-between flex-col items-center'>
                    <div className='w-full mt-5'>
                        <div className='flex items-center gap-5 p-3 border-b-2'>
                            <i className="text-lg ri-map-pin-2-fill"></i>
                            <div>
                                <h3 className='text-lg font-medium'>{ride?.destination?.split(',')[0]}</h3>
                                <p className='text-sm -mt-1 text-gray-600'>{ride?.destination}</p>
                            </div>
                        </div>
                        <div className='flex items-center gap-5 p-3'>
                            <i className="ri-currency-line"></i>
                            <div>
                                <h3 className='text-lg font-medium'>R${ride?.fare}</h3>
                                <p className='text-sm -mt-1 text-gray-600'>Valor Total</p>
                            </div>
                        </div>
                    </div>
                </div>

                {ride?.paymentMethod === 'carteira' ? (
                    <div className='flex flex-col gap-2 mt-4'>
                        <div className='w-full bg-green-50 border border-green-200 text-green-700 font-semibold p-3 rounded-xl text-center flex items-center justify-center gap-2'>
                            <i className="ri-checkbox-circle-fill"></i> Já pago pela carteira
                        </div>
                        <button
                            onClick={() => { setModalStep('rating'); setShowPayModal(true) }}
                            className='w-full bg-white border-2 border-green-500 text-green-600 font-semibold p-3 rounded-xl transition-colors hover:bg-green-50'
                        >Avaliar Motorista</button>
                    </div>
                ) : (
                    <button
                        onClick={() => { setModalStep('payment'); setShowPayModal(true) }}
                        className='w-full mt-4 bg-green-500 hover:bg-green-600 text-white font-semibold p-3 rounded-xl text-lg transition-colors shadow-lg shadow-green-500/20'
                    >Acertar Pagamento</button>
                )}
            </div>

            {/* ── Modal pós-corrida: 'payment' -> 'rating' -> 'done' ── */}
            {showPayModal && (
                <div className='fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm'>
                    <div className='w-full max-w-md bg-white rounded-t-3xl px-6 py-8 shadow-2xl animate-slide-up'>

                        {modalStep === 'payment' && (
                            <>
                                <div className='flex justify-between items-center mb-6'>
                                    <h2 className='text-2xl font-bold text-gray-800'>Acertar R${ride?.fare}</h2>
                                    <button onClick={() => setShowPayModal(false)}>
                                        <i className="ri-close-line text-2xl text-gray-500"></i>
                                    </button>
                                </div>

                                <div className='bg-yellow-50 border border-yellow-300 rounded-xl p-4 mb-6 flex gap-3 items-center'>
                                    <i className="ri-information-line text-yellow-500 text-xl"></i>
                                    <p className='text-sm text-yellow-700'>
                                        Pague <strong>R${ride?.fare}</strong> {ride?.paymentMethod === 'pix' ? 'via Pix' : 'em dinheiro'} diretamente ao motorista. O app não processa este pagamento.
                                    </p>
                                </div>

                                {error && (
                                    <div className='bg-red-50 border border-red-300 rounded-xl p-3 mb-4 flex gap-2 items-center'>
                                        <i className="ri-error-warning-line text-red-500"></i>
                                        <p className='text-sm text-red-600'>{error}</p>
                                    </div>
                                )}

                                <button
                                    onClick={handleConfirmPayment}
                                    disabled={loading}
                                    className='w-full bg-green-500 hover:bg-green-600 disabled:bg-green-400 text-white font-bold p-4 rounded-xl text-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-green-500/20'
                                >
                                    {loading ? (
                                        <>
                                            <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                            </svg>
                                            Enviando...
                                        </>
                                    ) : (
                                        'Já paguei o motorista'
                                    )}
                                </button>
                            </>
                        )}

                        {modalStep === 'rating' && (
                            <>
                                <div className='flex justify-between items-center mb-2'>
                                    <h2 className='text-2xl font-bold text-gray-800'>Avalie a corrida</h2>
                                    <button onClick={() => setShowPayModal(false)}>
                                        <i className="ri-close-line text-2xl text-gray-500"></i>
                                    </button>
                                </div>
                                <p className='text-sm text-gray-500 mb-5'>
                                    Como foi sua viagem com {ride?.captain?.fullname?.firstname || 'o motorista'}?
                                </p>

                                <div className='flex justify-center gap-2 mb-5'>
                                    {[1, 2, 3, 4, 5].map(star => (
                                        <button
                                            key={star}
                                            type='button'
                                            onClick={() => setRatingValue(star)}
                                            className='p-1'
                                        >
                                            <i className={`text-4xl ${star <= ratingValue ? 'ri-star-fill text-yellow-400' : 'ri-star-line text-gray-300'}`}></i>
                                        </button>
                                    ))}
                                </div>

                                <textarea
                                    value={ratingComment}
                                    onChange={e => setRatingComment(e.target.value)}
                                    placeholder='Deixe um comentário (opcional)'
                                    rows={3}
                                    className='w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-green-400 focus:outline-none mb-5 resize-none'
                                />

                                <button
                                    onClick={handleSubmitReview}
                                    disabled={!ratingValue || submittingReview}
                                    className='w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white font-bold p-4 rounded-xl text-lg transition-all shadow-lg shadow-green-500/20 mb-2'
                                >
                                    {submittingReview ? 'Enviando...' : 'Enviar Avaliação'}
                                </button>
                                <button
                                    onClick={() => setModalStep('done')}
                                    className='w-full text-gray-500 font-medium p-2'
                                >
                                    Pular
                                </button>
                            </>
                        )}

                        {modalStep === 'done' && (
                            <div className='flex flex-col items-center py-6'>
                                <div className='h-20 w-20 rounded-full bg-green-100 flex items-center justify-center mb-4'>
                                    <i className="ri-checkbox-circle-fill text-5xl text-green-500"></i>
                                </div>
                                <h2 className='text-2xl font-bold text-gray-800 mb-1'>Tudo certo!</h2>
                                <p className='text-gray-500 mb-8'>Obrigado por viajar conosco 🙏</p>
                                <button
                                    onClick={() => navigate('/home')}
                                    className='w-full bg-green-500 hover:bg-green-600 text-white font-semibold p-3 rounded-xl text-lg transition-colors shadow-lg shadow-green-500/20'
                                >
                                    Voltar ao Início
                                </button>
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