import React, { useState, useContext, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { SocketContext } from '@/contexts/SocketContext'
import { UserDataContext } from '@/contexts/UserContext'
import LiveTracking from '@/shared/components/LiveTracking'
import axios from 'axios'
import { vehicleImages, vehicleLabels } from '@/assets/vehicleAssets'
import { useToast } from '@/contexts/ToastContext'
import RideChat from '@/shared/components/RideChat'

const Riding = () => {
    const location = useLocation()
    const { ride } = location.state || {}
    const { socket } = useContext(SocketContext)
    const { user } = useContext(UserDataContext)
    const navigate = useNavigate()
    const { addToast } = useToast()

    const [ showPayModal, setShowPayModal ] = useState(false)
    const [ payMethod, setPayMethod ] = useState('') // 'upi' | 'card' | 'cash'
    const [ upiId, setUpiId ] = useState('')
    const [ cardNum, setCardNum ] = useState('')
    const [ cardName, setCardName ] = useState('')
    const [ cardExpiry, setCardExpiry ] = useState('')
    const [ cardCvv, setCardCvv ] = useState('')
    const [ loading, setLoading ] = useState(false)
    const [ paid, setPaid ] = useState(false)
    const [ error, setError ] = useState('')
    const [ isChatOpen, setIsChatOpen ] = useState(false)
    const [ unreadCount, setUnreadCount ] = useState(0)

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
            setShowPayModal(true)
            addToast(
                `Viagem concluída! Pague R$${ride?.fare}`,
                'money',
                6000,
                'Escolha sua forma de pagamento abaixo'
            )
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

    async function handlePay() {
        setError('')
        if (payMethod === 'upi' && !upiId.includes('@')) {
            return setError('Enter a valid UPI ID (e.g. name@upi)')
        }
        if (payMethod === 'card') {
            if (cardNum.replace(/\s/g, '').length < 16) return setError('Enter a valid 16-digit card number')
            if (!cardName.trim()) return setError('Enter cardholder name')
            if (!cardExpiry.match(/^\d{2}\/\d{2}$/)) return setError('Enter expiry as MM/YY')
            if (cardCvv.length < 3) return setError('Enter a valid CVV')
        }

        setLoading(true)
        try {
            await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/pay`, {
                rideId: ride._id
            }, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            })
            setPaid(true)
            addToast('Pagamento concluído! Obrigado 🙏', 'success', 5000, 'Esperamos que tenha gostado da viagem')
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Pagamento Confirmado! ✅', {
                    body: `R$${ride?.fare} pago. Obrigado por viajar com a MoveCity!`,
                    icon: '/movecity-icon.jpg'
                })
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Payment failed. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    function formatCardNum(val) {
        return val.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim()
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

                <button
                    onClick={() => setShowPayModal(true)}
                    className='w-full mt-4 bg-green-500 hover:bg-green-600 text-white font-semibold p-3 rounded-xl text-lg transition-colors shadow-lg shadow-green-500/20'
                >Fazer Pagamento</button>
            </div>

            {/* ── Payment Modal ── */}
            {showPayModal && (
                <div className='fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm'>
                    <div className='w-full max-w-md bg-white rounded-t-3xl px-6 py-8 shadow-2xl animate-slide-up'>

                        {paid ? (
                            /* Success Screen */
                            <div className='flex flex-col items-center py-6'>
                                <div className='h-20 w-20 rounded-full bg-green-100 flex items-center justify-center mb-4'>
                                    <i className="ri-checkbox-circle-fill text-5xl text-green-500"></i>
                                </div>
                                <h2 className='text-2xl font-bold text-gray-800 mb-1'>Pagamento Concluído!</h2>
                                <p className='text-gray-500 mb-2'>R$${ride?.fare} pagos com sucesso</p>
                                <p className='text-xs text-gray-400 mb-8'>Obrigado por viajar conosco 🙏</p>
                                <button
                                    onClick={() => navigate('/home')}
                                    className='w-full bg-green-500 hover:bg-green-600 text-white font-semibold p-3 rounded-xl text-lg transition-colors shadow-lg shadow-green-500/20'
                                >
                                    Voltar ao Início
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className='flex justify-between items-center mb-6'>
                                    <h2 className='text-2xl font-bold text-gray-800'>Pagar R$${ride?.fare}</h2>
                                    <button onClick={() => setShowPayModal(false)}>
                                        <i className="ri-close-line text-2xl text-gray-500"></i>
                                    </button>
                                </div>

                                {/* Payment Method Selector */}
                                <div className='flex gap-3 mb-6'>
                                    {[
                                        { id: 'upi', icon: 'ri-qr-code-line', label: 'Pix/UPI' },
                                        { id: 'card', icon: 'ri-bank-card-line', label: 'Cartão' },
                                        { id: 'cash', icon: 'ri-money-rupee-circle-line', label: 'Dinheiro' }
                                    ].map(m => (
                                        <button
                                            key={m.id}
                                            onClick={() => { setPayMethod(m.id); setError('') }}
                                            className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                                                payMethod === m.id
                                                    ? 'border-green-500 bg-green-50 text-green-700'
                                                    : 'border-gray-200 text-gray-500'
                                            }`}
                                        >
                                            <i className={`${m.icon} text-2xl`}></i>
                                            <span className='text-xs font-semibold'>{m.label}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* UPI Form */}
                                {payMethod === 'upi' && (
                                    <div className='mb-4'>
                                        <label className='block text-sm font-medium text-gray-600 mb-1'>UPI ID</label>
                                        <input
                                            value={upiId}
                                            onChange={e => setUpiId(e.target.value)}
                                            placeholder='yourname@upi'
                                            className='w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-green-400 focus:outline-none'
                                        />
                                    </div>
                                )}

                                {/* Card Form */}
                                {payMethod === 'card' && (
                                    <div className='space-y-3 mb-4'>
                                        <div>
                                            <label className='block text-sm font-medium text-gray-600 mb-1'>Card Number</label>
                                            <input
                                                value={cardNum}
                                                onChange={e => setCardNum(formatCardNum(e.target.value))}
                                                placeholder='1234 5678 9012 3456'
                                                maxLength={19}
                                                className='w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base tracking-widest focus:border-green-400 focus:outline-none'
                                            />
                                        </div>
                                        <div>
                                            <label className='block text-sm font-medium text-gray-600 mb-1'>Cardholder Name</label>
                                            <input
                                                value={cardName}
                                                onChange={e => setCardName(e.target.value)}
                                                placeholder='John Doe'
                                                className='w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-green-400 focus:outline-none'
                                            />
                                        </div>
                                        <div className='flex gap-3'>
                                            <div className='flex-1'>
                                                <label className='block text-sm font-medium text-gray-600 mb-1'>Expiry</label>
                                                <input
                                                    value={cardExpiry}
                                                    onChange={e => {
                                                        const v = e.target.value.replace(/\D/g, '').slice(0,4)
                                                        setCardExpiry(v.length > 2 ? v.slice(0,2) + '/' + v.slice(2) : v)
                                                    }}
                                                    placeholder='MM/YY'
                                                    maxLength={5}
                                                    className='w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-green-400 focus:outline-none'
                                                />
                                            </div>
                                            <div className='flex-1'>
                                                <label className='block text-sm font-medium text-gray-600 mb-1'>CVV</label>
                                                <input
                                                    value={cardCvv}
                                                    onChange={e => setCardCvv(e.target.value.replace(/\D/g, '').slice(0,4))}
                                                    placeholder='•••'
                                                    maxLength={4}
                                                    type='senha'
                                                    className='w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-green-400 focus:outline-none'
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Cash Note */}
                                {payMethod === 'cash' && (
                                    <div className='bg-yellow-50 border border-yellow-300 rounded-xl p-4 mb-4 flex gap-3 items-center'>
                                        <i className="ri-information-line text-yellow-500 text-xl"></i>
                                        <p className='text-sm text-yellow-700'>Por favor, pague <strong>R$${ride?.fare}</strong> em dinheiro ao motorista.</p>
                                    </div>
                                )}

                                {/* Error */}
                                {error && (
                                    <div className='bg-red-50 border border-red-300 rounded-xl p-3 mb-4 flex gap-2 items-center'>
                                        <i className="ri-error-warning-line text-red-500"></i>
                                        <p className='text-sm text-red-600'>{error}</p>
                                    </div>
                                )}

                                {/* Pay Button */}
                                {payMethod && (
                                    <button
                                        onClick={handlePay}
                                        disabled={loading}
                                        className='w-full bg-green-500 hover:bg-green-600 disabled:bg-green-400 text-white font-bold p-4 rounded-xl text-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-green-500/20'
                                    >
                                        {loading ? (
                                            <>
                                                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                                </svg>
                                                Processing...
                                            </>
                                        ) : (
                                            `Pagar R$${ride?.fare}`
                                        )}
                                    </button>
                                )}
                            </>
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