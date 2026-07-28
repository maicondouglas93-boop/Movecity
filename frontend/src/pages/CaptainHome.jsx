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
import axios from 'axios'
import LiveTracking from '../components/LiveTracking'
import { useToast } from '../context/ToastContext'
import CaptainHeader from '../components/CaptainHeader'
import { requestFCMToken } from '../services/fcm'

const CaptainHome = () => {

    const [ ridePopupPanel, setRidePopupPanel ] = useState(false)
    const [ confirmRidePopupPanel, setConfirmRidePopupPanel ] = useState(false)

    const ridePopupPanelRef = useRef(null)
    const confirmRidePopupPanelRef = useRef(null)
    const [ ride, setRide ] = useState(null)

    const { socket } = useContext(SocketContext)
    const { captain } = useContext(CaptainDataContext)
    const { addToast } = useToast()

    // Request browser notification permission on mount
    useEffect(() => {
        const setupFCM = async () => {
            if ('Notification' in window) {
                const permission = await Notification.requestPermission()
                if (permission === 'granted') {
                    await requestFCMToken();
                }
            }
        };
        setupFCM();
    }, [])

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

        let locationInterval;
        let simulationInterval;

        const updateLocation = () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(position => {
                    socket.emit('update-location-captain', {
                        userId: captain._id,
                        location: {
                            ltd: position.coords.latitude,
                            lng: position.coords.longitude
                        }
                    })
                }, () => {
                    console.error('Falha ao obter localização do GPS');
                })
            }
        }

        // If ride is confirmed, simulate captain moving towards the pickup location
        if (ride && ride.status === 'accepted') {
            const fetchPickupAndSimulate = async () => {
                try {
                    const token = localStorage.getItem('captain-token');
                    const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-coordinates`, {
                        params: { address: ride.pickup },
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    const pickupCoords = response.data;
                    if (pickupCoords && pickupCoords.ltd && pickupCoords.lng) {
                        // Start offset by ~1.2km away
                        let currentLat = pickupCoords.ltd + 0.01;
                        let currentLng = pickupCoords.lng + 0.01;
                        let step = 0;
                        const totalSteps = 40;

                        simulationInterval = setInterval(() => {
                            if (step >= totalSteps) {
                                clearInterval(simulationInterval);
                                return;
                            }
                            // Interpolate towards pickup
                            currentLat = currentLat + (pickupCoords.ltd - currentLat) * 0.12;
                            currentLng = currentLng + (pickupCoords.lng - currentLng) * 0.12;

                            socket.emit('update-location-captain', {
                                userId: captain._id,
                                location: { ltd: currentLat, lng: currentLng }
                            });
                            step++;
                        }, 2000);
                    }
                } catch (err) {
                    console.error('Simulation error:', err);
                    updateLocation();
                }
            };
            fetchPickupAndSimulate();
        } else {
            locationInterval = setInterval(updateLocation, 10000)
            updateLocation()
        }

        const handleNewRide = (data) => {
            setRide(data)
            setRidePopupPanel(true)
            
            // Audio and Vibration
            try {
                const audio = new Audio('/sounds/new-ride.wav');
                audio.play().catch(e => console.log('Audio autoplay prevented:', e));
                if (navigator.vibrate) {
                    navigator.vibrate([500, 200, 500]);
                }
            } catch (err) {
                console.error(err);
            }

            // In-app toast
            addToast(`Nova solicitação de ${data.vehicleType?.toUpperCase() || 'corrida'} de ${data.user?.fullname?.firstname || 'um passageiro'}!`, 'ride')
            // Browser push notification (Local fallback, even though FCM will handle background)
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Nova Solicitação de Corrida! 🚗', {
                    body: `${data.pickup?.split(',')[0]} → ${data.destination?.split(',')[0]} • R$${data.fare}`,
                    icon: '/movecity-icon.jpg'
                })
            }
        }

        socket.on('new-ride', handleNewRide)

        return () => {
            if (locationInterval) clearInterval(locationInterval)
            if (simulationInterval) clearInterval(simulationInterval)
            socket.off('connect', handleConnect)
            socket.off('new-ride', handleNewRide)
        }
    }, [captain, ride])


    async function confirmRide() {

        const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/confirm`, {

            rideId: ride._id,
            captainId: captain._id,

        }, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('captain-token')}`
            }
        })

        // Update ride state with full confirmed data (includes OTP for captain)
        if (response.data) {
            setRide(response.data)
        }
        setRidePopupPanel(false)
        setConfirmRidePopupPanel(true)

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
        <div className='h-screen'>


            <div className='h-3/5'>
                <LiveTracking ride={ride} />
            </div>
            <div className='h-2/5 p-6 overflow-y-auto pb-24'>
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