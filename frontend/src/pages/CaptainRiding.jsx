import React, { useRef, useState, useEffect, useContext, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import FinishRide from '../components/FinishRide'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import LiveTracking from '../components/LiveTracking'
import { SocketContext } from '../context/SocketContext'
import { CaptainDataContext } from '../context/CapatainContext'
import axios from 'axios'
import { vehicleImages, vehicleLabels } from '../assets/vehicleAssets'
import { useToast } from '../context/ToastContext'
import RideChat from '../components/RideChat'

const CaptainRiding = () => {

    const [ finishRidePanel, setFinishRidePanel ] = useState(false)
    const finishRidePanelRef = useRef(null)
    const simulationRef = useRef(null)
    const location = useLocation()
    const rideData = location.state?.ride
    const { socket } = useContext(SocketContext)
    const navigate = useNavigate()
    const { captain } = useContext(CaptainDataContext)
    const { addToast } = useToast()
    const [ isChatOpen, setIsChatOpen ] = useState(false)
    const [ unreadCount, setUnreadCount ] = useState(0)

    const showBrowserNotification = (title, body) => {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body,
                icon: '/movecity-icon.jpg'
            })
        }
    }

    /* ── Location simulation: captain moves from pickup → destination ── */
    useEffect(() => {
        if (!captain?._id || !rideData) return;

        const handleConnect = () => {
            socket.emit('join', { userId: captain._id, userType: 'captain' })
        }

        if (socket.connected) {
            handleConnect()
        }

        socket.on('connect', handleConnect)

        // Clear any old simulation before starting a new one
        if (simulationRef.current) clearInterval(simulationRef.current)

        const startSimulation = async () => {
            try {
                const token = localStorage.getItem('captain-token');
                const [ pickupRes, destRes ] = await Promise.all([
                    axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-coordinates`, {
                        params: { address: rideData.pickup },
                        headers: { Authorization: `Bearer ${token}` }
                    }),
                    axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-coordinates`, {
                        params: { address: rideData.destination },
                        headers: { Authorization: `Bearer ${token}` }
                    })
                ]);

                const pc = pickupRes.data;
                const dc = destRes.data;

                if (pc?.ltd && dc?.ltd) {
                    let lat = pc.ltd, lng = pc.lng, step = 0;
                    const totalSteps = 60;

                    simulationRef.current = setInterval(() => {
                        if (step >= totalSteps) {
                            clearInterval(simulationRef.current);
                            simulationRef.current = null;
                            return;
                        }
                        lat = lat + (dc.ltd - lat) * 0.08;
                        lng = lng + (dc.lng - lng) * 0.08;
                        socket.emit('update-location-captain', {
                            userId: captain._id,
                            location: { ltd: lat, lng: lng }
                        });
                        step++;
                    }, 2000);
                }
            } catch (err) {
                console.error('Simulation error in CaptainRiding:', err);
            }
        };

        startSimulation();
        addToast('Corrida iniciada — navegue até o destino!', 'info')
        showBrowserNotification('Corrida Iniciada', `A caminho de ${rideData?.destination?.split(',')[0]}`)

        return () => {
            if (simulationRef.current) {
                clearInterval(simulationRef.current);
                simulationRef.current = null;
            }
            socket.off('connect', handleConnect)
        }
    }, [captain?._id, rideData?.pickup, rideData?.destination])  // stable deps only

    /* ── Payment received socket event ── */
    useEffect(() => {
        const handlePaymentCompleted = () => {
            addToast(`Pagamento recebido! R$${rideData?.fare}`, 'success')
            showBrowserNotification(
                'Pagamento Recebido! 💰',
                `R$${rideData?.fare} recebido de ${rideData?.user?.fullname?.firstname || 'passageiro'}`
            )
            setTimeout(() => navigate('/captain-home'), 3500)
        }
        
        const handleReceiveMessage = (msg) => {
            if (!isChatOpen) {
                setUnreadCount(prev => prev + 1);
                addToast('Nova mensagem do passageiro', 'info');
                
                try {
                    const audio = new Audio('/sounds/new-ride.wav');
                    audio.play().catch(e => console.log(e));
                } catch (e) {}
            }
        }
        
        socket.on('payment-completed', handlePaymentCompleted)
        socket.on('receive-message', handleReceiveMessage)
        
        return () => {
            socket.off('payment-completed', handlePaymentCompleted)
            socket.off('receive-message', handleReceiveMessage)
        }
    }, [socket, navigate, rideData, addToast, isChatOpen])
    
    // Reset unread count when chat opens
    useEffect(() => {
        if (isChatOpen) setUnreadCount(0);
    }, [isChatOpen])
    
    // Fetch initial unread count
    useEffect(() => {
        const fetchUnread = async () => {
            try {
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/chat/${rideData?._id}`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('captain-token')}` }
                });
                if (response.data.chat) {
                    setUnreadCount(response.data.chat.unreadCaptain || 0);
                }
            } catch (err) {}
        };
        if (rideData?._id) fetchUnread();
    }, [rideData])

    /* ── Slide-up panel animation ── */
    useGSAP(() => {
        if (!finishRidePanelRef.current) return;
        gsap.to(finishRidePanelRef.current, {
            transform: finishRidePanel ? 'translateY(0)' : 'translateY(100%)',
            duration: 0.35,
            ease: 'power2.out'
        })
    }, [ finishRidePanel ])

    const vType = rideData?.vehicleType || 'car'
    const vehicleLabel = vehicleLabels[vType] || 'MoveGo'
    const vehicleImg = vehicleImages[vType] || vehicleImages.car

    return (
        <div className='h-screen relative overflow-hidden'>

            {/* Full-screen map — full z-index so it's interactive */}
            <div className='absolute inset-0 z-0'>
                <LiveTracking ride={rideData} />
            </div>

            {/* Toast Notifications — rendered by global ToastProvider */}

            {/* Top bar */}
            <div className='absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-4 pointer-events-none'>
                <img className='w-20 pointer-events-auto drop-shadow-md' src="/movecity-logo.png" alt="MoveCity" />
                <div className='flex flex-col gap-2 pointer-events-auto'>
                    <Link
                        to='/captain-home'
                        className='h-10 w-10 bg-white flex items-center justify-center rounded-full shadow-md pointer-events-auto'
                    >
                        <i className="text-lg ri-home-5-line"></i>
                    </Link>
                    <button 
                        onClick={() => setIsChatOpen(true)}
                        className='h-10 w-10 bg-white flex items-center justify-center rounded-full shadow-md relative pointer-events-auto'
                    >
                        <i className="text-lg font-medium ri-chat-3-line"></i>
                        {unreadCount > 0 && (
                            <span className='absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold shadow-sm'>
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* Bottom HUD — tap to open FinishRide panel */}
            <div className='absolute bottom-0 left-0 right-0 z-20'>
                <div
                    className='bg-white border-t border-gray-200 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)] cursor-pointer select-none'
                    onClick={() => setFinishRidePanel(true)}
                >
                    {/* Drag handle */}
                    <div className='flex justify-center pt-3 pb-2'>
                        <div className='h-1.5 w-12 bg-gray-300 rounded-full'></div>
                    </div>

                    <div className='px-5 pb-6 pt-1 flex items-center justify-between gap-3'>
                        {/* Vehicle + Passenger Info */}
                        <div className='flex items-center gap-3 min-w-0'>
                            <img
                                src={vehicleImg}
                                alt={vehicleLabel}
                                className='h-14 w-20 object-contain flex-shrink-0'
                            />
                            <div className='min-w-0'>
                                <p className='text-[10px] text-green-600 font-bold uppercase tracking-widest'>{vehicleLabel}</p>
                                <h4 className='text-base font-bold text-gray-800 leading-tight truncate'>
                                    {rideData?.user?.fullname?.firstname || 'Passageiro'} {rideData?.user?.fullname?.lastname || ''}
                                </h4>
                                <p className='text-xs text-gray-500 font-medium'>
                                    {rideData?.distance ? `${(rideData.distance / 1000).toFixed(1)} km` : 'A caminho'}
                                    {rideData?.fare ? ` • R$${rideData.fare}` : ''}
                                </p>
                            </div>
                        </div>

                        {/* Complete button */}
                        <button
                            onClick={(e) => { e.stopPropagation(); setFinishRidePanel(true) }}
                            className='flex-shrink-0 bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-5 rounded-2xl text-sm shadow-lg shadow-green-500/20 active:scale-95 transition-all whitespace-nowrap'
                        >
                            <i className="ri-flag-fill mr-1"></i>
                            Concluir
                        </button>
                    </div>
                </div>
            </div>

            {/* Finish Ride Slide-up Panel */}
            <div
                ref={finishRidePanelRef}
                className='fixed w-full z-50 bottom-0 translate-y-full bg-white px-3 py-10 pt-12 rounded-t-3xl shadow-2xl'
            >
                <FinishRide
                    ride={rideData}
                    setFinishRidePanel={setFinishRidePanel}
                />
            </div>

            {/* Slide-down keyframe (inline fallback) */}
            <style>{`
                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-12px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
            
            <RideChat 
                ride={rideData} 
                isOpen={isChatOpen} 
                onClose={() => setIsChatOpen(false)} 
                currentUserType="captain" 
            />
        </div>
    )
}

export default CaptainRiding