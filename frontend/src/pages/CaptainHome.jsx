import React, { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CaptainDetails from '../components/CaptainDetails'
import RidePopUp from '../components/RidePopUp'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import ConfirmRidePopUp from '../components/ConfirmRidePopUp'
import { useEffect, useContext } from 'react'
import { SocketContext } from '../context/SocketContext'
import { CaptainDataContext } from '../context/CapatainContext'
import { LocationContext } from '../context/LocationContext'
import axios from 'axios'
import LiveTracking from '../components/LiveTracking'
import { useToast } from '../context/ToastContext'
import CaptainHeader from '../components/CaptainHeader'
import { requestFCMToken } from '../services/fcm'
import { useWakeLock } from '../hooks/useWakeLock'
import { db } from '../db/db'
import * as Sentry from '@sentry/react'

const CaptainHome = () => {

    const [ ridePopupPanel, setRidePopupPanel ] = useState(false)
    const [ confirmRidePopupPanel, setConfirmRidePopupPanel ] = useState(false)

    const ridePopupPanelRef = useRef(null)
    const confirmRidePopupPanelRef = useRef(null)
    const [ ride, setRide ] = useState(null)

    const { socket } = useContext(SocketContext)
    const { captain } = useContext(CaptainDataContext)
    const { locationRef } = useContext(LocationContext)
    const { addToast } = useToast()

    useEffect(() => {
        const setupFCM = async () => {
            if ('Notification' in window && Notification.permission === 'granted') {
                await requestFCMToken();
            }
        };
        setupFCM();
    }, [])

    const { requestLock } = useWakeLock();
    useEffect(() => {
        requestLock();
    }, [requestLock]);

    // Ref para acessar o ride atual dentro de handlers sem precisar re-subscrever
    const rideRef = useRef(ride)
    useEffect(() => { rideRef.current = ride }, [ride])

    // --- Efeito 1: conexão e listeners do socket (só depende do captain) ---
    useEffect(() => {
        if (!captain || !captain._id) return;

        const handleConnect = () => {
            socket.emit('join', {
                userId: captain._id,
                userType: 'captain'
            })
        }

        if (socket.connected) {
            handleConnect()
        }
        socket.on('connect', handleConnect)

        const handleNewRide = (data) => {
            const TRACE_ID = `Ride:${data._id}`;
            console.log(`[AUDIT][${TRACE_ID}] Evento 'new-ride' recebido no Frontend via Socket. Dados:`, data);

            setRide(data)
            setRidePopupPanel(true)
            console.log(`[AUDIT][${TRACE_ID}] Modal RidePopUp ativado.`);

            try {
                const audio = new Audio('/sounds/new-ride.wav');
                audio.play().then(() => {
                    console.log(`[AUDIT][${TRACE_ID}] Som de notificação tocado com sucesso.`);
                }).catch(e => {
                    console.warn(`[AUDIT][${TRACE_ID}] Falha ao tocar som (Autoplay bloqueado?):`, e);
                });
                
                if (navigator.vibrate) {
                    navigator.vibrate([500, 200, 500]);
                    console.log(`[AUDIT][${TRACE_ID}] Vibração acionada.`);
                }
            } catch (err) {
                console.error(`[AUDIT][${TRACE_ID}] Erro nas APIs de mídia:`, err);
            }

            addToast(`Nova solicitação de ${data.vehicleType?.toUpperCase() || 'corrida'} de ${data.user?.fullname?.firstname || 'um passageiro'}!`, 'ride')

            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Nova Solicitação de Corrida! 🚗', {
                    body: `${data.pickup?.split(',')[0]} → ${data.destination?.split(',')[0]} • R$${data.fare}`,
                    icon: '/movecity-icon.jpg'
                })
                console.log(`[AUDIT][${TRACE_ID}] Web Push Nativo (Browser) exibido.`);
            } else {
                console.log(`[AUDIT][${TRACE_ID}] Web Push não exibido (Sem permissão ou API inexistente). Permissão atual:`, Notification.permission);
            }
        }

        const handleRideCancelled = (data) => {
            if (rideRef.current && rideRef.current._id === data.rideId) {
                setRidePopupPanel(false)
                setRide(null)
                addToast('A corrida foi cancelada pelo passageiro.', 'info')
            }
        }

        socket.on('new-ride', handleNewRide)
        socket.on('ride-cancelled', handleRideCancelled)

        return () => {
            socket.off('connect', handleConnect)
            socket.off('new-ride', handleNewRide)
            socket.off('ride-cancelled', handleRideCancelled)
        }
    }, [captain, socket])

    // --- Efeito 2: atualização/simulação de localização (depende do status do ride) ---
    const OFFSET_DEG = 0.01
    const INTERPOLATION_FACTOR = 0.12
    const SIMULATION_STEPS = 40
    const SIMULATION_INTERVAL_MS = 2000
    const REAL_LOCATION_INTERVAL_MS = 10000

    useEffect(() => {
        if (!captain || !captain._id) return;

        let locationInterval;
        let simulationInterval;
        let cancelled = false;

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

        if (ride && ride.status === 'accepted') {
            const fetchPickupAndSimulate = async () => {
                try {
                    const token = localStorage.getItem('captain-token');
                    const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-coordinates`, {
                        params: { address: ride.pickup },
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    const pickupCoords = response.data;
                    if (cancelled || !pickupCoords?.ltd || !pickupCoords?.lng) return;

                    let currentLat = pickupCoords.ltd + OFFSET_DEG;
                    let currentLng = pickupCoords.lng + OFFSET_DEG;
                    let step = 0;

                    simulationInterval = setInterval(() => {
                        if (step >= SIMULATION_STEPS) {
                            clearInterval(simulationInterval);
                            return;
                        }
                        currentLat += (pickupCoords.ltd - currentLat) * INTERPOLATION_FACTOR;
                        currentLng += (pickupCoords.lng - currentLng) * INTERPOLATION_FACTOR;

                        socket.emit('update-location-captain', {
                            userId: captain._id,
                            location: { ltd: currentLat, lng: currentLng }
                        });
                        step++;
                    }, SIMULATION_INTERVAL_MS);
                } catch (err) {
                    console.error('Simulation error:', err);
                    updateLocation();
                }
            };
            fetchPickupAndSimulate();
        } else {
            locationInterval = setInterval(updateLocation, REAL_LOCATION_INTERVAL_MS)
            updateLocation()
        }

        return () => {
            cancelled = true;
            if (locationInterval) clearInterval(locationInterval);
            if (simulationInterval) clearInterval(simulationInterval);
        }
    }, [captain, socket, ride?.status, ride?.pickup])


    async function confirmRide() {
        try {
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/confirm`, {
                rideId: ride._id,
                captainId: captain._id,
            }, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('captain-token')}`
                }
            })

            if (response.data) {
                setRide(response.data)
            }
            setRidePopupPanel(false)
            setConfirmRidePopupPanel(true)
        } catch (err) {
            console.error('Confirm ride error:', err);
            if (!navigator.onLine || err.code === 'ERR_NETWORK') {
                db.offlineActions.add({
                    type: 'accept-ride',
                    rideId: ride._id,
                    payload: { rideId: ride._id, captainId: captain._id },
                    timestamp: Date.now()
                }).catch(e => console.error(e));
                
                // Optimistic UI updates
                const optimisticRide = { ...ride, status: 'accepted', captain };
                setRide(optimisticRide);
                setRidePopupPanel(false)
                setConfirmRidePopupPanel(true)
            } else {
                addToast('Falha ao confirmar corrida. Pode já ter sido aceita.', 'error');
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
            }
        }
    }


    useGSAP(function () {
        if (ridePopupPanel) {
            gsap.to(ridePopupPanelRef.current, {
                transform: 'translateY(0)'
            })
        } else {
            gsap.to(ridePopupPanelRef.current, {
                transform: 'translateY(100%)'
            })
        }
    }, [ ridePopupPanel ])

    useGSAP(function () {
        if (confirmRidePopupPanel) {
            gsap.to(confirmRidePopupPanelRef.current, {
                transform: 'translateY(0)'
            })
        } else {
            gsap.to(confirmRidePopupPanelRef.current, {
                transform: 'translateY(100%)'
            })
        }
    }, [ confirmRidePopupPanel ])

    return (
        <div className='h-screen flex flex-col overflow-hidden bg-gray-50'>

            <div className='h-[40vh] relative shadow-sm z-10'>
                <LiveTracking ride={ride} showSearchRadius={true} />
            </div>
            <div className='h-[60vh] p-4 overflow-y-auto pb-24'>
                <CaptainDetails />
            </div>
            <div ref={ridePopupPanelRef} className='fixed w-full z-[70] bottom-0 translate-y-full bg-white px-3 py-10 pt-12'>
                <RidePopUp
                    ride={ride}
                    setRidePopupPanel={setRidePopupPanel}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel}
                    confirmRide={confirmRide}
                />
            </div>
            <div ref={confirmRidePopupPanelRef} className='fixed w-full h-screen z-[70] bottom-0 translate-y-full bg-white px-3 py-10 pt-12'>
                <ConfirmRidePopUp
                    ride={ride}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel} setRidePopupPanel={setRidePopupPanel} />
            </div>
            <CaptainHeader />
        </div>
    )
}

export default CaptainHome