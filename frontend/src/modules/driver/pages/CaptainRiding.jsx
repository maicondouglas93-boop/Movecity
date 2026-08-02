import React, { useState, useEffect, useContext } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import FinishRide from '@/modules/driver/components/FinishRide'
import BottomSheet from '@/shared/components/ui/BottomSheet'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'
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

    const vType = rideData?.vehicleType || 'car'
    const vehicleLabel = vehicleLabels[vType] || 'MoveGo'
    const vehicleImg = vehicleImages[vType] || vehicleImages.car

    if (rehydrating) {
        return (
            <div className='h-screen flex items-center justify-center bg-surface-alt'>
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600"></div>
            </div>
        )
    }

    return (
        <div className='h-screen relative overflow-hidden'>
            <ConnectionBanner />

            {/* Full-screen map — full z-index so it's interactive */}
            <div className='absolute inset-0 z-base'>
                <LiveTracking ride={rideData} />
            </div>

            {/* Toast Notifications — rendered by global ToastProvider */}

            {/* Top bar */}
            <div className='absolute top-0 left-0 right-0 z-panel flex items-center justify-between px-4 pt-4 pointer-events-none'>
                <img className='w-20 pointer-events-auto drop-shadow-md' src="/movecity-logo.png" alt="MoveCity" />
                <div className='flex flex-col gap-2 pointer-events-auto'>
                    <Link
                        to='/captain-home'
                        aria-label="Voltar para a Home"
                        className='h-11 w-11 bg-surface flex items-center justify-center rounded-full shadow-raised pointer-events-auto'
                    >
                        <i className="text-lg ri-home-5-line"></i>
                    </Link>
                    {/* Auditoria de UX do motorista (2026-08-02, Etapa 7, §4): não existia
                        nenhum jeito de navegar até o destino nem de ligar pro passageiro —
                        só chat, e só depois de já iniciada a corrida. */}
                    {rideData?.destination && (
                        <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(rideData.destination)}&travelmode=driving`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Navegar até o destino"
                            className='h-11 w-11 bg-brand-500 text-white flex items-center justify-center rounded-full shadow-raised pointer-events-auto'
                        >
                            <i className="text-lg ri-navigation-fill"></i>
                        </a>
                    )}
                    {rideData?.user?.phone && (
                        <a
                            href={`tel:${rideData.user.phone}`}
                            aria-label="Ligar para o passageiro"
                            className='h-11 w-11 bg-surface flex items-center justify-center rounded-full shadow-raised pointer-events-auto'
                        >
                            <i className="text-lg ri-phone-fill"></i>
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={() => setIsChatOpen(true)}
                        aria-label="Abrir chat com o passageiro"
                        className='h-11 w-11 bg-surface flex items-center justify-center rounded-full shadow-raised relative pointer-events-auto'
                    >
                        <i className="text-lg font-medium ri-chat-3-line"></i>
                        {unreadCount > 0 && (
                            <span className='absolute -top-1 -right-1 bg-danger-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold shadow-raised'>
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* Bottom HUD — tap to open FinishRide panel */}
            <div className='absolute bottom-0 left-0 right-0 z-overlay'>
                <div
                    className='bg-surface border-t border-line rounded-t-3xl shadow-floating cursor-pointer select-none'
                    onClick={() => setFinishRidePanel(true)}
                >
                    {/* Drag handle */}
                    <div className='flex justify-center pt-3 pb-2'>
                        <div className='h-1.5 w-12 bg-line rounded-full'></div>
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
                                <p className='text-xs text-brand-600 font-bold uppercase tracking-widest'>{vehicleLabel}</p>
                                <h4 className='text-base font-bold text-ink-900 leading-tight truncate'>
                                    {rideData?.user?.fullname?.firstname || 'Passageiro'} {rideData?.user?.fullname?.lastname || ''}
                                </h4>
                                {/* Destino sempre visível (§4 do relatório de UX) — antes só
                                    aparecia abrindo o painel de finalizar corrida. */}
                                <p className='text-xs text-ink-900 font-medium truncate flex items-center gap-1'>
                                    <i className="ri-map-pin-2-fill text-danger-500 text-xs flex-shrink-0"></i>
                                    {rideData?.destination?.split(',')[0] || 'Destino'}
                                </p>
                                <p className='text-xs text-ink-600 font-medium'>
                                    {rideData?.fare ? `R$${rideData.fare}` : ''}
                                </p>
                            </div>
                        </div>

                        {/* Complete button */}
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setFinishRidePanel(true) }}
                            className='flex-shrink-0 bg-brand-500 hover:bg-brand-600 text-white font-bold py-3 px-5 rounded-panel text-sm shadow-floating active:scale-95 transition-all whitespace-nowrap'
                        >
                            <i className="ri-flag-fill mr-1"></i>
                            Concluir
                        </button>
                    </div>
                </div>
            </div>

            <BottomSheet open={finishRidePanel} onClose={() => setFinishRidePanel(false)} className="pb-6">
                <FinishRide
                    ride={rideData}
                    setFinishRidePanel={setFinishRidePanel}
                />
            </BottomSheet>

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