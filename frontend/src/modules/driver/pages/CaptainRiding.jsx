import React, { useRef, useState, useEffect, useContext, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import FinishRide from '@/modules/driver/components/FinishRide'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import LiveTracking from '@/shared/components/LiveTracking'
import { SocketContext } from '@/contexts/SocketContext'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { LocationContext } from '@/contexts/LocationContext'
import axios from 'axios'
import { vehicleImages, vehicleLabels } from '@/assets/vehicleAssets'
import { useToast } from '@/contexts/ToastContext'
import RideChat from '@/shared/components/RideChat'
import { useWakeLock } from '@/shared/hooks/useWakeLock'
import { db } from '@/services/db'

const CaptainRiding = () => {

    const [ finishRidePanel, setFinishRidePanel ] = useState(false)
    const finishRidePanelRef = useRef(null)
    const location = useLocation()
    // Auditoria de UX do motorista (2026-08-02, §2.6): rideData vivia só em
    // location.state, que não sobrevive a um refresh de página nem ao app sendo
    // derrubado em segundo plano — nesses casos o motorista ficava no meio de uma
    // corrida (com o passageiro no carro) e a tela perdia tudo: passageiro, destino,
    // valor, mapa vazio. Agora começa com o state (otimização — resposta imediata) e,
    // se ele vier vazio, busca a corrida ativa de verdade no servidor.
    const [ rideData, setRideData ] = useState(location.state?.ride || null)
    const [ rehydrating, setRehydrating ] = useState(!location.state?.ride)
    const { socket } = useContext(SocketContext)
    const navigate = useNavigate()
    const { captain } = useContext(CaptainDataContext)
    const { locationRef } = useContext(LocationContext)
    const { addToast } = useToast()
    const [ isChatOpen, setIsChatOpen ] = useState(false)
    const [ unreadCount, setUnreadCount ] = useState(0)

    useEffect(() => {
        if (rideData) {
            setRehydrating(false)
            return
        }

        let cancelled = false
        axios.get(`${import.meta.env.VITE_BASE_URL}/rides/captain-current`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('captain-token')}` }
        }).then(response => {
            if (cancelled) return
            setRideData(response.data)
        }).catch(() => {
            if (cancelled) return
            addToast('Nenhuma corrida em andamento encontrada.', 'info')
            navigate('/captain-home')
        }).finally(() => {
            if (!cancelled) setRehydrating(false)
        })

        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const showBrowserNotification = (title, body) => {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body,
                icon: '/movecity-icon.jpg'
            })
        }
    }

    const { requestLock } = useWakeLock();
    useEffect(() => {
        requestLock();
    }, [requestLock]);

    /* ── Envio periódico da localização real (GPS) do motorista durante a corrida ── */
    const REAL_LOCATION_INTERVAL_MS = 5000

    useEffect(() => {
        if (!captain?._id || !rideData) return;

        const handleConnect = () => {
            socket.emit('join', { userId: captain._id, userType: 'captain' })
        }

        if (socket.connected) {
            handleConnect()
        }

        socket.on('connect', handleConnect)

        const updateLocation = () => {
            const loc = locationRef.current;
            if (!loc) return;

            if (socket.connected) {
                socket.emit('update-location-captain', {
                    userId: captain._id,
                    location: { ltd: loc.lat, lng: loc.lng }
                });
            } else {
                db.driverLocations.add({
                    userId: captain._id,
                    lat: loc.lat,
                    lng: loc.lng,
                    timestamp: Date.now()
                }).catch(e => console.error(e));
            }
        };

        const locationInterval = setInterval(updateLocation, REAL_LOCATION_INTERVAL_MS)
        updateLocation()

        addToast('Corrida iniciada — navegue até o destino!', 'info')
        showBrowserNotification('Corrida Iniciada', `A caminho de ${rideData?.destination?.split(',')[0]}`)

        return () => {
            clearInterval(locationInterval);
            socket.off('connect', handleConnect)
        }
    }, [captain?._id, rideData?._id])  // stable deps only

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

    if (rehydrating) {
        return (
            <div className='h-screen flex items-center justify-center bg-gray-50'>
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
            </div>
        )
    }

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