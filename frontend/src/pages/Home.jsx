import React, { useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import axios from 'axios';
import 'remixicon/fonts/remixicon.css'
import LocationSearchPanel from '../components/LocationSearchPanel';
import VehiclePanel from '../components/VehiclePanel';
import ConfirmRide from '../components/ConfirmRide';
import LookingForDriver from '../components/LookingForDriver';
import WaitingForDriver from '../components/WaitingForDriver';
import { SocketContext } from '../context/SocketContext';
import { useContext } from 'react';
import { UserDataContext } from '../context/UserContext';
import { useNavigate, useLocation } from 'react-router-dom';
import LiveTracking from '../components/LiveTracking';
import { useToast } from '../context/ToastContext';
import Header from '../components/Header';
import ScheduleRidePanel from '../components/ScheduleRidePanel';
import { requestFCMToken } from '../services/fcm';

const Home = () => {
    const [ pickup, setPickup ] = useState('')
    const [ destination, setDestination ] = useState('')
    const [ panelOpen, setPanelOpen ] = useState(false)
    const [ schedulePanelOpen, setSchedulePanelOpen ] = useState(false)
    const vehiclePanelRef = useRef(null)
    const confirmRidePanelRef = useRef(null)
    const vehicleFoundRef = useRef(null)
    const waitingForDriverRef = useRef(null)
    const panelRef = useRef(null)
    const panelCloseRef = useRef(null)
    const [ vehiclePanel, setVehiclePanel ] = useState(false)
    const [ confirmRidePanel, setConfirmRidePanel ] = useState(false)
    const [ vehicleFound, setVehicleFound ] = useState(false)
    const [ waitingForDriver, setWaitingForDriver ] = useState(false)
    const [ pickupSuggestions, setPickupSuggestions ] = useState([])
    const [ destinationSuggestions, setDestinationSuggestions ] = useState([])
    const [ activeField, setActiveField ] = useState(null)
    const [ fare, setFare ] = useState({})
    const [ vehicleType, setVehicleType ] = useState(null)
    const [ ride, setRide ] = useState(null)

    const [ isSelectingOnMap, setIsSelectingOnMap ] = useState(false)
    const [ mapSelectionCoords, setMapSelectionCoords ] = useState(null)
    const [ userLocation, setUserLocation ] = useState(null)
    const [ isSearching, setIsSearching ] = useState(false)
    const debounceTimer = useRef(null)
    const location = useLocation()

    useEffect(() => {
        // If coming from Repeat Ride, prefill and find trip
        if (location.state && location.state.pickup && location.state.destination) {
            setPickup(location.state.pickup);
            setDestination(location.state.destination);
            // clear state so it doesn't loop
            window.history.replaceState({}, document.title)
        }
    }, [location.state])

    useEffect(() => {
        // Obter localização inicial ao carregar a página
        if (navigator.geolocation && !pickup) {
            navigator.geolocation.getCurrentPosition(async (position) => {
                const { latitude, longitude } = position.coords;
                setUserLocation({ lat: latitude, lng: longitude });
                
                try {
                    const response = await axios.get(`https://photon.komoot.io/reverse?lon=${longitude}&lat=${latitude}`);
                    if (response.data && response.data.features && response.data.features.length > 0) {
                        const properties = response.data.features[0].properties;
                        const address = [properties.name, properties.street, properties.city || properties.state].filter(Boolean).join(', ');
                        if (address) {
                            setPickup({
                                address: address,
                                lat: latitude,
                                lng: longitude
                            });
                        }
                    }
                } catch (err) {
                    console.warn("Reverse geocode on mount failed", err);
                }
            }, () => {}, { timeout: 10000, enableHighAccuracy: true });
        }
        
        // Configurar Push Notifications para Passageiro
        const setupFCM = async () => {
            if ('Notification' in window) {
                const permission = await Notification.requestPermission()
                if (permission === 'granted') {
                    await requestFCMToken();
                }
            }
        };
        setupFCM();
    }, []); // Run once on mount

    const requestLocationPermissions = () => {
        if (navigator.geolocation && !userLocation) {
            navigator.geolocation.getCurrentPosition((position) => {
                setUserLocation({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                });
            }, () => {}, { timeout: 10000, enableHighAccuracy: true });
        }
    }

    const confirmMapSelection = async () => {
        if (!mapSelectionCoords) {
            setIsSelectingOnMap(false);
            return;
        }
        addToast('Confirmando endereço...', 'info');
        const { lat, lng } = mapSelectionCoords;
        let address = "";
        try {
            const response = await axios.get(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
            if (response.data && response.data.features && response.data.features.length > 0) {
                const properties = response.data.features[0].properties;
                address = [properties.name, properties.street, properties.city || properties.state].filter(Boolean).join(', ');
            }
        } catch (err) {
            console.warn("Reverse geocode failed", err);
        }

        if (activeField === 'pickup') {
            setPickup({ address: address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng });
        } else {
            setDestination({ address: address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng });
        }
        
        setIsSelectingOnMap(false);
        setPanelOpen(true); 
        addToast('Local confirmado no mapa!', 'success');
    }

    const navigate = useNavigate()

    const { socket } = useContext(SocketContext)
    const { user } = useContext(UserDataContext)
    const { addToast } = useToast()

    useEffect(() => {
        if (!user || !user._id) return;

        const handleConnect = () => {
            socket.emit("join", { userType: "user", userId: user._id })
        }

        if (socket.connected) {
            handleConnect()
        }

        socket.on('connect', handleConnect)

        const handleRideConfirmed = (ride) => {
            setVehicleFound(false)
            setWaitingForDriver(true)
            setRide(ride)
            addToast(
                `Motorista encontrado! OTP: ${ride.otp}`,
                'otp',
                7000,
                `${ride.captain?.fullname?.firstname} está indo até você`
            )
            // Browser notification
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Motorista Confirmado! 🚗', {
                    body: `Seu OTP é ${ride.otp} — compartilhe com o motorista`,
                    icon: '/movecity-icon.jpg'
                })
            }
        }

        const handleRideStarted = (ride) => {
            addToast('Ride started! Enjoy your trip 🎉', 'ride', 4000, 'Your path is being tracked')
            setWaitingForDriver(false)
            navigate('/riding', { state: { ride } })
        }

        socket.on('ride-confirmed', handleRideConfirmed)
        socket.on('ride-started', handleRideStarted)

        return () => {
            socket.off('connect', handleConnect)
            socket.off('ride-confirmed', handleRideConfirmed)
            socket.off('ride-started', handleRideStarted)
        }
    }, [user])


    const handlePickupChange = (e) => {
        const val = e.target.value;
        setPickup(val)
        
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        
        if (val.length >= 3) {
            setIsSearching(true);
            debounceTimer.current = setTimeout(async () => {
                try {
                    const params = { input: val };
                    if (userLocation) {
                        params.lat = userLocation.lat;
                        params.lng = userLocation.lng;
                    }
                    const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-suggestions`, {
                        params,
                        headers: {
                            Authorization: `Bearer ${localStorage.getItem('token')}`
                        }
                    })
                    setPickupSuggestions(response.data)
                } catch {
                    setPickupSuggestions([])
                } finally {
                    setIsSearching(false);
                }
            }, 400); // 400ms debounce
        } else {
            setPickupSuggestions([]);
        }
    }

    const handleDestinationChange = (e) => {
        const val = e.target.value;
        setDestination(val)
        
        if (debounceTimer.current) clearTimeout(debounceTimer.current);

        if (val.length >= 3) {
            setIsSearching(true);
            debounceTimer.current = setTimeout(async () => {
                try {
                    const params = { input: val };
                    if (userLocation) {
                        params.lat = userLocation.lat;
                        params.lng = userLocation.lng;
                    }
                    const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/maps/get-suggestions`, {
                        params,
                        headers: {
                            Authorization: `Bearer ${localStorage.getItem('token')}`
                        }
                    })
                    setDestinationSuggestions(response.data)
                } catch {
                    setDestinationSuggestions([])
                } finally {
                    setIsSearching(false);
                }
            }, 400); // 400ms debounce
        } else {
            setDestinationSuggestions([]);
        }
    }

    const submitHandler = (e) => {
        e.preventDefault()
    }

    const handleCurrentLocation = () => {
        if (!navigator.geolocation) {
            addToast('Geolocalização não suportada', 'error');
            return;
        }

        addToast('Obtendo sua localização...', 'info');

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                try {
                    const response = await axios.get(`https://photon.komoot.io/reverse?lon=${longitude}&lat=${latitude}`);
                    if (response.data && response.data.features && response.data.features.length > 0) {
                        const properties = response.data.features[0].properties;
                        const address = [properties.name, properties.street, properties.city || properties.state].filter(Boolean).join(', ');
                        setPickup({ address: address || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, lat: latitude, lng: longitude });
                        addToast('Localização atual definida', 'success');
                    } else {
                        setPickup({ address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, lat: latitude, lng: longitude });
                        addToast('Usando coordenadas', 'info');
                    }
                } catch (err) {
                    setPickup({ address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, lat: latitude, lng: longitude });
                    addToast('Endereço indisponível, usando coords', 'info');
                }
            }, 
            (err) => {
                console.error("Geolocation error:", err);
                addToast('Não foi possível obter localização', 'error');
            }, 
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    useGSAP(function () {
        if (panelOpen) {
            gsap.to(panelRef.current, {
                height: '70vh',
                padding: 24
                // opacity:1
            })
            gsap.to(panelCloseRef.current, {
                opacity: 1
            })
        } else {
            gsap.to(panelRef.current, {
                height: 0,
                padding: 0
                // opacity:0
            })
            gsap.to(panelCloseRef.current, {
                opacity: 0
            })
        }
    }, [ panelOpen ])


    useGSAP(function () {
        if (vehiclePanel) {
            vehiclePanelRef.current.classList.remove('invisible')
            gsap.to(vehiclePanelRef.current, {
                transform: 'translateY(0)',
                duration: 0.3
            })
        } else {
            gsap.to(vehiclePanelRef.current, {
                transform: 'translateY(100%)',
                duration: 0.3,
                onComplete: () => vehiclePanelRef.current?.classList.add('invisible')
            })
        }
    }, [ vehiclePanel ])

    useGSAP(function () {
        if (confirmRidePanel) {
            confirmRidePanelRef.current.classList.remove('invisible')
            gsap.to(confirmRidePanelRef.current, {
                transform: 'translateY(0)',
                duration: 0.3
            })
        } else {
            gsap.to(confirmRidePanelRef.current, {
                transform: 'translateY(100%)',
                duration: 0.3,
                onComplete: () => confirmRidePanelRef.current?.classList.add('invisible')
            })
        }
    }, [ confirmRidePanel ])

    useGSAP(function () {
        if (vehicleFound) {
            vehicleFoundRef.current.classList.remove('invisible')
            gsap.to(vehicleFoundRef.current, {
                transform: 'translateY(0)',
                duration: 0.3
            })
        } else {
            gsap.to(vehicleFoundRef.current, {
                transform: 'translateY(100%)',
                duration: 0.3,
                onComplete: () => vehicleFoundRef.current?.classList.add('invisible')
            })
        }
    }, [ vehicleFound ])

    useGSAP(function () {
        if (waitingForDriver) {
            waitingForDriverRef.current.classList.remove('invisible')
            gsap.to(waitingForDriverRef.current, {
                transform: 'translateY(0)',
                duration: 0.3
            })
        } else {
            gsap.to(waitingForDriverRef.current, {
                transform: 'translateY(100%)',
                duration: 0.3,
                onComplete: () => waitingForDriverRef.current?.classList.add('invisible')
            })
        }
    }, [ waitingForDriver ])


    async function findTrip() {
        setVehiclePanel(true)
        setPanelOpen(false)

        const pickupStr = typeof pickup === 'object' ? `${pickup.address} (${pickup.lat}, ${pickup.lng})` : pickup;
        const destStr = typeof destination === 'object' ? `${destination.address} (${destination.lat}, ${destination.lng})` : destination;

        const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/get-fare`, {
            params: { pickup: pickupStr, destination: destStr },
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        })


        setFare(response.data)


    }

    async function createRide() {
        addToast('Looking for nearby drivers...', 'info', 5000, 'This may take a moment')
        
        const pickupStr = typeof pickup === 'object' ? `${pickup.address} (${pickup.lat}, ${pickup.lng})` : pickup;
        const destStr = typeof destination === 'object' ? `${destination.address} (${destination.lat}, ${destination.lng})` : destination;

        const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/create`, {
            pickup: pickupStr,
            destination: destStr,
            vehicleType
        }, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        })
    }

    return (
        <div className='h-[100dvh] relative overflow-hidden'>
            <div className='h-[100dvh] w-screen'>
                {/* image for temporary use  */}
                <LiveTracking 
                    ride={ride} 
                    pickup={pickup} 
                    destination={destination} 
                    vehicleType={vehicleType} 
                    isSelectingOnMap={isSelectingOnMap}
                    onMapCenterChange={(coords) => setMapSelectionCoords(coords)}
                />
            </div>
            
            <div className={`absolute w-full pointer-events-none z-20 transition-all duration-300 bottom-0`}>
                <div className={`h-auto pb-8 p-6 bg-white relative pointer-events-auto transition-transform duration-300 shadow-2xl rounded-t-3xl ${(isSelectingOnMap || vehiclePanel || confirmRidePanel || vehicleFound || waitingForDriver || schedulePanelOpen) ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}>
                    
                    {!panelOpen ? (
                        <>
                            <div className="w-12 h-1.5 bg-green-200 rounded-full mx-auto mb-5"></div>
                            <h4 className='text-2xl font-bold mb-5 text-gray-800 text-center'>
                                {`${new Date().getHours() < 12 ? 'Bom dia' : new Date().getHours() < 18 ? 'Boa tarde' : 'Boa noite'}, ${user?.fullname?.firstname || ''}`}
                            </h4>
                            <div className="flex items-center gap-3">
                                <div 
                                    onClick={() => {
                                        setPanelOpen(true)
                                        setActiveField('destination')
                                        requestLocationPermissions()
                                    }}
                                    className="flex-1 bg-gray-50 border border-gray-200 px-5 py-4 rounded-full flex items-center gap-3 cursor-pointer shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    <i className="ri-search-line text-2xl text-green-500 font-bold"></i>
                                    <span className="text-gray-500 font-semibold text-lg">Buscar destino</span>
                                </div>
                                <div 
                                    onClick={() => setSchedulePanelOpen(true)}
                                    className="h-16 w-16 bg-gray-50 border border-gray-200 rounded-full flex items-center justify-center cursor-pointer shadow-sm active:bg-gray-100 flex-shrink-0"
                                >
                                    <i className="ri-calendar-schedule-fill text-2xl text-green-500"></i>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <h5 ref={panelCloseRef} onClick={() => setPanelOpen(false)} className='absolute right-6 top-6 text-2xl cursor-pointer text-gray-400 hover:text-green-500'>
                                <i className="ri-arrow-down-wide-line"></i>
                            </h5>
                            <h4 className='text-2xl font-semibold text-gray-800'>Escolha um destino</h4>
                            <form className='relative mt-4' onSubmit={submitHandler}>
                                {/* Timeline / Dots */}
                                <div className="absolute left-2 top-[22px] bottom-[26px] flex flex-col items-center">
                                    <div className="w-2.5 h-2.5 rounded-full border-2 border-green-500 bg-white z-10"></div>
                                    <div className="w-0.5 bg-green-200 flex-1 my-1"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 z-10"></div>
                                </div>

                                <div className="pl-8">
                                    {/* Pickup Field */}
                                    <div className="border-b border-gray-200 pb-2 mb-2 relative">
                                        <label className="text-xs text-green-600 font-medium ml-1">Partida</label>
                                        <input
                                            onClick={() => {
                                                setActiveField('pickup')
                                                requestLocationPermissions()
                                            }}
                                            value={typeof pickup === 'object' ? pickup.address : pickup}
                                            onChange={handlePickupChange}
                                            className='w-full px-1 py-1 text-[16px] text-gray-800 font-medium outline-none bg-transparent placeholder-gray-400'
                                            type="text"
                                            placeholder='Local de partida'
                                        />
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleCurrentLocation();
                                            }}
                                            className='absolute right-0 top-1/2 translate-y-[-20%] text-gray-400 hover:text-green-500 flex items-center justify-center p-2 z-20'
                                            title="Usar minha localização atual"
                                        >
                                            <i className="ri-gps-line text-xl"></i>
                                        </button>
                                    </div>

                                    {/* Destination Field */}
                                    <div className="relative pt-1">
                                        <label className="text-xs text-green-600 font-medium ml-1">Destino</label>
                                        <input
                                            onClick={() => {
                                                setActiveField('destination')
                                                requestLocationPermissions()
                                            }}
                                            autoFocus
                                            value={typeof destination === 'object' ? destination.address : destination}
                                            onChange={handleDestinationChange}
                                            className='w-full px-1 py-1 text-[16px] text-gray-800 font-medium outline-none bg-transparent placeholder-gray-400'
                                            type="text"
                                            placeholder='Para onde você vai?' 
                                        />
                                    </div>
                                </div>
                            </form>
                            <button
                                onClick={findTrip}
                                className='bg-green-500 hover:bg-green-600 text-white font-bold px-4 py-3 rounded-xl mt-3 w-full transition-colors shadow-lg shadow-green-500/20'>
                                Buscar Corrida
                            </button>
                        </>
                    )}
                </div>
                <div ref={panelRef} className={`bg-white h-0 overflow-hidden pointer-events-auto transition-transform duration-300 ${isSelectingOnMap ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}>
                    <LocationSearchPanel
                        suggestions={activeField === 'pickup' ? pickupSuggestions : destinationSuggestions}
                        setPanelOpen={setPanelOpen}
                        setVehiclePanel={setVehiclePanel}
                        setPickup={setPickup}
                        setDestination={setDestination}
                        activeField={activeField}
                        setIsSelectingOnMap={setIsSelectingOnMap}
                        isSearching={isSearching}
                    />
                </div>
            </div>

            {/* Map Selection Confirm UI */}
            {isSelectingOnMap && (
                <div className='absolute bottom-0 left-0 w-full bg-white px-5 py-6 shadow-[0_-10px_20px_rgba(0,0,0,0.1)] z-50 rounded-t-3xl animate-slide-up pointer-events-auto'>
                    <h3 className='text-center text-lg font-semibold mb-5 text-gray-800'>
                        Mova o mapa para o {activeField === 'pickup' ? 'local de partida' : 'destino'}
                    </h3>
                    <button 
                        onClick={confirmMapSelection}
                        className='w-full bg-green-500 text-white font-bold py-3.5 rounded-xl text-lg shadow-lg shadow-green-500/20 active:scale-95 transition-transform'
                    >
                        Confirmar {activeField === 'pickup' ? 'Local de Partida' : 'Destino'}
                    </button>
                    <button 
                        onClick={() => setIsSelectingOnMap(false)}
                        className='w-full bg-gray-100 text-gray-600 py-3.5 rounded-xl text-lg font-medium mt-3 active:bg-gray-200 transition-colors'
                    >
                        Cancelar
                    </button>
                </div>
            )}
            <div ref={vehiclePanelRef} className='fixed w-full z-30 bottom-0 translate-y-full invisible bg-white px-3 pt-12 pb-[env(safe-area-inset-bottom,16px)] rounded-t-3xl shadow-2xl max-h-[85dvh] overflow-y-auto'>
                <VehiclePanel
                    selectVehicle={setVehicleType}
                    fare={fare} setConfirmRidePanel={setConfirmRidePanel} setVehiclePanel={setVehiclePanel} />
            </div>
            <div ref={confirmRidePanelRef} className='fixed w-full z-30 bottom-0 translate-y-full invisible bg-white px-3 pt-12 pb-[env(safe-area-inset-bottom,16px)] rounded-t-3xl shadow-2xl max-h-[85dvh] overflow-y-auto'>
                <ConfirmRide
                    createRide={createRide}
                    pickup={pickup}
                    destination={destination}
                    fare={fare}
                    vehicleType={vehicleType}
                    setConfirmRidePanel={setConfirmRidePanel} setVehicleFound={setVehicleFound} />
            </div>
            <div ref={vehicleFoundRef} className='fixed w-full z-30 bottom-0 translate-y-full invisible bg-white px-3 pt-12 pb-[env(safe-area-inset-bottom,16px)] rounded-t-3xl shadow-2xl max-h-[85dvh] overflow-y-auto'>
                <LookingForDriver
                    createRide={createRide}
                    pickup={pickup}
                    destination={destination}
                    fare={fare}
                    vehicleType={vehicleType}
                    setVehicleFound={setVehicleFound} />
            </div>
            <div ref={waitingForDriverRef} className='fixed w-full z-30 bottom-0 translate-y-full invisible bg-white px-3 pt-12 pb-[env(safe-area-inset-bottom,16px)] rounded-t-3xl shadow-2xl max-h-[85dvh] overflow-y-auto'>
                <WaitingForDriver
                    ride={ride}
                    setVehicleFound={setVehicleFound}
                    setWaitingForDriver={setWaitingForDriver}
                    waitingForDriver={waitingForDriver} />
            </div>

            {/* Bottom Navigation */}
            {!(panelOpen || vehiclePanel || confirmRidePanel || vehicleFound || waitingForDriver || isSelectingOnMap || schedulePanelOpen) && (
                <Header />
            )}

            <ScheduleRidePanel schedulePanelOpen={schedulePanelOpen} setSchedulePanelOpen={setSchedulePanelOpen} />
        </div>
    )
}

export default Home