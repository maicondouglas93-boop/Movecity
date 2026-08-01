import React, { useState, useEffect, useRef, useContext, useCallback, memo } from 'react'
import { SocketContext } from '@/contexts/SocketContext'
import { LocationContext } from '@/contexts/LocationContext'
import { createMapProvider } from '@/services/maps'

const sanitizeCoord = (lat, lng) => {
    if (lat === null || lat === undefined || lat === '' || isNaN(Number(lat))) return null;
    if (lng === null || lng === undefined || lng === '' || isNaN(Number(lng))) return null;
    const nLat = Number(lat);
    const nLng = Number(lng);
    if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) return null;
    return { lat: nLat, lng: nLng };
};

const getRemainingRoute = (route, position) => {
    if (!route || route.length === 0) return [];
    if (!position || isNaN(position.lat) || isNaN(position.lng)) return route;

    let closestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < route.length; i++) {
        const dx = route[i][0] - position.lat;
        const dy = route[i][1] - position.lng;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistance) {
            minDistance = distSq;
            closestIdx = i;
        }
    }

    return [[position.lat, position.lng], ...route.slice(closestIdx)];
};

const calculateRouteDistance = (coords) => {
    if (!coords || coords.length < 2) return 0;
    let totalDist = 0;

    const toRad = (val) => (val * Math.PI) / 180;
    const R = 6371; // Earth radius in km

    for (let i = 0; i < coords.length - 1; i++) {
        const lat1 = coords[i][0];
        const lon1 = coords[i][1];
        const lat2 = coords[i+1][0];
        const lon2 = coords[i+1][1];

        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        totalDist += R * c;
    }
    return totalDist;
};

const LiveTracking = (props) => {
    const mapRef = useRef(null);
    const providerRef = useRef(null);
    const hasCaptainMarkerRef = useRef(false);

    const { socket } = useContext(SocketContext);
    const { userLocation } = useContext(LocationContext);

    // Use ref for current position to avoid destroying the map
    const currentPositionRef = useRef(null);
    const [hasPosition, setHasPosition] = useState(false);

    const [ captainPosition, setCaptainPosition ] = useState(null);
    const [ pickupCoords, setPickupCoords ] = useState(null);
    const [ destinationCoords, setDestinationCoords ] = useState(null);
    const [ routeCoords, setRouteCoords ] = useState([]);
    const [ isFollowing, setIsFollowing ] = useState(true);

    const prevCaptainPosRef = useRef(null);
    const hasFitBoundsRef = useRef(false);
    const onMapCenterChangeRef = useRef(props.onMapCenterChange);
    const routeCoordsRef = useRef([]);

    // Keep routeCoordsRef in sync
    useEffect(() => {
        routeCoordsRef.current = routeCoords;
    }, [routeCoords]);

    useEffect(() => {
        onMapCenterChangeRef.current = props.onMapCenterChange;
    }, [props.onMapCenterChange]);

    // GPS tracking sync from Global Context
    useEffect(() => {
        if (!userLocation) return;
        const { lat, lng } = userLocation;

        currentPositionRef.current = { lat, lng };

        // Update marker position directly
        if (providerRef.current) {
            providerRef.current.placeMarker('user', { lat, lng }, { type: 'user' });
        }

        // Signal that we have a position (only once, to trigger map init)
        if (!hasPosition) {
            setHasPosition(true);
        }
    }, [userLocation]); // Syncs automatically when global location updates

    // Initialize captain position from ride details if available
    useEffect(() => {
        if (props.ride?.captain?.location?.ltd && props.ride?.captain?.location?.lng) {
            const newPos = {
                lat: props.ride.captain.location.ltd,
                lng: props.ride.captain.location.lng
            };
            setCaptainPosition(newPos);
        }
    }, [props.ride]);

    // Listen for real-time captain location updates
    useEffect(() => {
        if (!socket) return;

        const handleCaptainLocationUpdated = (data) => {
            setCaptainPosition({
                lat: data.ltd,
                lng: data.lng
            });
        };

        socket.on('captain-location-updated', handleCaptainLocationUpdated);

        return () => {
            socket.off('captain-location-updated', handleCaptainLocationUpdated);
        };
    }, [socket]);

    // Initialize pickup and destination coordinates from props/ride
    useEffect(() => {
        const fetchCoords = async () => {
            const activePickup = props.ride?.pickup || props.pickup;
            const activeDestination = props.ride?.destination || props.destination;

            if (!activePickup && !activeDestination) {
                setPickupCoords(null);
                setDestinationCoords(null);
                setRouteCoords([]);
                if (providerRef.current) {
                    providerRef.current.removeMarker('pickup');
                    providerRef.current.removeMarker('destination');
                    providerRef.current.removeRoute();
                }
                return;
            }

            const token = localStorage.getItem('token') || localStorage.getItem('captain-token');
            if (!token) return;

            try {
                if (activePickup) {
                    const parsed = typeof activePickup === 'object' ? activePickup : { address: activePickup };
                    const coord = sanitizeCoord(parsed.lat, parsed.lng);

                    if (coord) {
                        setPickupCoords(coord);
                    } else if (parsed.address && typeof parsed.address === 'string' && parsed.address.length >= 3) {
                        const response = await fetch(`${import.meta.env.VITE_BASE_URL}/maps/get-coordinates?address=${encodeURIComponent(parsed.address)}`, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        const data = await response.json();
                        const fetchedCoord = sanitizeCoord(data.ltd, data.lng);
                        if (fetchedCoord) {
                            setPickupCoords(fetchedCoord);
                        }
                    }
                }

                if (activeDestination) {
                    const parsed = typeof activeDestination === 'object' ? activeDestination : { address: activeDestination };
                    const coord = sanitizeCoord(parsed.lat, parsed.lng);

                    if (coord) {
                        setDestinationCoords(coord);
                    } else if (parsed.address && typeof parsed.address === 'string' && parsed.address.length >= 3) {
                        const response = await fetch(`${import.meta.env.VITE_BASE_URL}/maps/get-coordinates?address=${encodeURIComponent(parsed.address)}`, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        const data = await response.json();
                        const fetchedCoord = sanitizeCoord(data.ltd, data.lng);
                        if (fetchedCoord) {
                            setDestinationCoords(fetchedCoord);
                        }
                    }
                }
            } catch (err) {
                console.error('Error fetching coords:', err);
            }
        };

        const debounceTimer = setTimeout(() => {
            fetchCoords();
        }, 800);

        return () => clearTimeout(debounceTimer);
    }, [props.ride, props.pickup, props.destination]);

    // Fetch road route polyline from OSRM depending on the ride phase
    useEffect(() => {
        const fetchRoute = async () => {
            if (!pickupCoords || !destinationCoords) return;

            let startLat = pickupCoords.lat;
            let startLng = pickupCoords.lng;
            let endLat = destinationCoords.lat;
            let endLng = destinationCoords.lng;

            // Fase 1 (motorista a caminho do embarque): traça do motorista até o pickup.
            // Fora dessa fase (corrida em andamento etc.) o default acima (pickup→destino)
            // já está certo, não precisa de outro ramo.
            // Antes só cobria status === 'accepted' — indo_para_embarque/chegou/aguardando
            // caíam no default errado (pickup→destino) mesmo com o motorista ainda a
            // caminho. 'ongoing' nunca existiu no enum real (é 'started').
            const headingToPickup = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'].includes(props.ride?.status);
            if (headingToPickup) {
                startLat = captainPosition?.lat || props.ride.captain?.location?.ltd || pickupCoords.lat;
                startLng = captainPosition?.lng || props.ride.captain?.location?.lng || pickupCoords.lng;
                endLat = pickupCoords.lat;
                endLng = pickupCoords.lng;
            }

            try {
                const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
                const response = await fetch(url);
                const data = await response.json();

                if (data.routes && data.routes.length > 0) {
                    const coordinates = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
                    setRouteCoords(coordinates);
                } else {
                    setRouteCoords([
                        [startLat, startLng],
                        [endLat, endLng]
                    ]);
                }
            } catch (err) {
                console.error('Error fetching OSRM route:', err);
                setRouteCoords([
                    [startLat, startLng],
                    [endLat, endLng]
                ]);
            }
        };

        fetchRoute();
    }, [pickupCoords, destinationCoords, props.ride?.status]);

    // ====== MAP INITIALIZATION — RUNS ONLY ONCE ======
    useEffect(() => {
        // Wait until we have a position and the DOM element
        if (!hasPosition || !mapRef.current || providerRef.current) return;

        const pos = currentPositionRef.current;
        if (!pos) return;

        // init() é assíncrono por contrato (o provider google carrega a API JS via
        // rede antes de poder criar o mapa). "cancelled" evita que um init ainda em
        // andamento vaze um mapa/listener se o componente desmontar nesse meio-tempo.
        let cancelled = false;
        const provider = createMapProvider();

        Promise.resolve(provider.init(mapRef.current, {
            center: pos,
            zoom: 15,
            onMoveEnd: (center) => {
                if (onMapCenterChangeRef.current) {
                    onMapCenterChangeRef.current(center);
                }
            },
            onDragStart: () => setIsFollowing(false),
            onZoomStart: () => setIsFollowing(false),
        })).then(() => {
            if (cancelled) {
                provider.destroy();
            } else {
                providerRef.current = provider;
            }
        }).catch((err) => {
            console.error('Falha ao inicializar o provider de mapa:', err);
        });

        // Cleanup only on unmount
        return () => {
            cancelled = true;
            if (providerRef.current) {
                providerRef.current.destroy();
                providerRef.current = null;
                hasCaptainMarkerRef.current = false;
            }
        };
    }, [hasPosition]); // Only when position first becomes available

    // Reset fit bounds flag when route or coordinates change
    useEffect(() => {
        hasFitBoundsRef.current = false;
    }, [pickupCoords, destinationCoords, routeCoords.length]);

    const handleRecenter = useCallback(() => {
        if (!providerRef.current) return;
        providerRef.current.invalidateSize();
        const allCoords = [];
        if (routeCoordsRef.current.length > 0) {
            allCoords.push(...routeCoordsRef.current);
        }

        const capCoord = sanitizeCoord(captainPosition?.lat, captainPosition?.lng);
        if (capCoord) allCoords.push([capCoord.lat, capCoord.lng]);

        const pickCoord = sanitizeCoord(pickupCoords?.lat, pickupCoords?.lng);
        if (pickCoord) allCoords.push([pickCoord.lat, pickCoord.lng]);

        const destCoord = sanitizeCoord(destinationCoords?.lat, destinationCoords?.lng);
        if (destCoord) allCoords.push([destCoord.lat, destCoord.lng]);

        // Fallback to currentPosition only if no other coordinates exist
        const pos = currentPositionRef.current;
        const curCoord = sanitizeCoord(pos?.lat, pos?.lng);
        if (allCoords.length === 0 && curCoord) {
            allCoords.push([curCoord.lat, curCoord.lng]);
        }

        if (allCoords.length > 0) {
            if (providerRef.current.fitBounds(allCoords, { padding: [50, 50], animate: true })) {
                setIsFollowing(true);
            }
        }
    }, [captainPosition, pickupCoords, destinationCoords]);

    // Update markers and polyline when data changes
    useEffect(() => {
        if (!providerRef.current) return;

        if (pickupCoords) {
            providerRef.current.placeMarker('pickup', pickupCoords, { type: 'pickup', title: 'Pickup Location', tooltip: 'Pickup' });
        }

        if (destinationCoords) {
            providerRef.current.placeMarker('destination', destinationCoords, { type: 'destination', title: 'Destination', tooltip: 'Destination' });
        }

        if (routeCoords.length > 0) {
            const remainingRoute = getRemainingRoute(routeCoords, captainPosition);
            providerRef.current.setRoute(remainingRoute);

            // Fit map bounds once
            if (!hasFitBoundsRef.current) {
                const allCoords = [...routeCoords];
                const capCoord = sanitizeCoord(captainPosition?.lat, captainPosition?.lng);
                if (capCoord) allCoords.push([capCoord.lat, capCoord.lng]);

                if (providerRef.current.fitBounds(allCoords, { padding: [50, 50], animate: true })) {
                    hasFitBoundsRef.current = true;
                }
            }
        } else {
            // Fit default bounds once
            if (!hasFitBoundsRef.current) {
                const boundsCoords = [];
                const pickCoord = sanitizeCoord(pickupCoords?.lat, pickupCoords?.lng);
                if (pickCoord) boundsCoords.push([pickCoord.lat, pickCoord.lng]);

                const destCoord = sanitizeCoord(destinationCoords?.lat, destinationCoords?.lng);
                if (destCoord) boundsCoords.push([destCoord.lat, destCoord.lng]);

                const capCoord = sanitizeCoord(captainPosition?.lat, captainPosition?.lng);
                if (capCoord) boundsCoords.push([capCoord.lat, capCoord.lng]);

                // Fallback to currentPosition only if no ride coordinates are set
                const pos = currentPositionRef.current;
                const curCoord = sanitizeCoord(pos?.lat, pos?.lng);
                if (boundsCoords.length === 0 && curCoord) {
                    boundsCoords.push([curCoord.lat, curCoord.lng]);
                }

                if (boundsCoords.length > 0) {
                    if (providerRef.current.fitBounds(boundsCoords, { padding: [50, 50], animate: true })) {
                        hasFitBoundsRef.current = true;
                    }
                }
            }
        }
    }, [pickupCoords, destinationCoords, routeCoords, captainPosition]);

    // Update captain position marker smoothly with linear interpolation
    useEffect(() => {
        if (!providerRef.current || !captainPosition) return;

        const startLat = prevCaptainPosRef.current ? prevCaptainPosRef.current.lat : captainPosition.lat;
        const startLng = prevCaptainPosRef.current ? prevCaptainPosRef.current.lng : captainPosition.lng;
        const endLat = captainPosition.lat;
        const endLng = captainPosition.lng;

        prevCaptainPosRef.current = captainPosition;

        const vType = props.ride?.vehicleType || props.ride?.captain?.vehicle?.vehicleType || props.vehicleType || 'car';

        // If it's the first time placing the captain marker
        if (!hasCaptainMarkerRef.current) {
            providerRef.current.placeMarker('captain', { lat: endLat, lng: endLng }, { type: vType });
            hasCaptainMarkerRef.current = true;
            return;
        } else {
            providerRef.current.setMarkerIcon('captain', vType);
        }

        // Animate the marker smoothly over 2 seconds (matching the emission frequency)
        const duration = 2000;
        const startTime = performance.now();

        let animationFrameId;

        const animateMarker = (timestamp) => {
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);

            const currentLat = startLat + (endLat - startLat) * progress;
            const currentLng = startLng + (endLng - startLng) * progress;

            if (providerRef.current) {
                providerRef.current.moveMarker('captain', { lat: currentLat, lng: currentLng });

                if (props.showSearchRadius) {
                    providerRef.current.setCircle({ lat: currentLat, lng: currentLng }, { radius: 3000 });
                }

                // Auto pan if follow mode is active
                if (isFollowing) {
                    providerRef.current.panTo({ lat: currentLat, lng: currentLng }, { animate: false });
                }
            }

            // Prune the route polyline smoothly on each animation frame
            if (routeCoordsRef.current.length > 0) {
                const remainingRoute = getRemainingRoute(routeCoordsRef.current, { lat: currentLat, lng: currentLng });
                providerRef.current.setRoute(remainingRoute);
            }

            if (progress < 1) {
                animationFrameId = requestAnimationFrame(animateMarker);
            }
        };

        animationFrameId = requestAnimationFrame(animateMarker);

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [captainPosition, props.vehicleType, props.ride?.vehicleType, props.ride?.captain?.vehicle?.vehicleType]);

    // HUD de fase da corrida — antes só cobria 'accepted' e 'ongoing' (este último nunca
    // existiu no enum real do backend), então o card de progresso nunca aparecia durante
    // a viagem de verdade ('started'). Ver item 9 do relatório de UX.
    const rideStatus = props.ride?.status;
    const ridePhaseLabel =
        ['accepted', 'going_to_pickup'].includes(rideStatus) ? 'Motorista a caminho'
        : ['arrived', 'waiting_passenger'].includes(rideStatus) ? 'Motorista chegou'
        : rideStatus === 'started' ? 'Corrida em andamento'
        : null;

    const showRemainingKm = ridePhaseLabel && rideStatus !== 'arrived' && rideStatus !== 'waiting_passenger';
    const remainingKm = showRemainingKm && routeCoords.length > 1 && captainPosition
        ? calculateRouteDistance(getRemainingRoute(routeCoords, captainPosition)).toFixed(1)
        : null;

    if (!hasPosition) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-surface-alt">
                <div className="flex flex-col items-center gap-2">
                    <i className="ri-map-pin-line text-3xl text-ink-400 animate-bounce"></i>
                    <p className="text-ink-600 font-medium">Obtendo localização...</p>
                </div>
            </div>
        );
    }

    return (
        <div className='relative w-full h-full'>
            <div ref={mapRef} style={{ width: '100%', height: '100%', zIndex: 0 }} />

            {/* Chip de status/progresso da corrida no topo do mapa */}
            {ridePhaseLabel && !props.isSelectingOnMap && (
                <div className='absolute top-4 left-1/2 -translate-x-1/2 z-panel flex items-center gap-3 bg-surface rounded-full shadow-raised px-5 py-2.5 border border-line'>
                    <div className='h-2.5 w-2.5 rounded-full bg-brand-500 animate-pulse flex-shrink-0'></div>
                    <div>
                        <p className='text-xs text-ink-400 leading-tight'>{ridePhaseLabel}</p>
                        {remainingKm && (
                            <p className='text-sm font-bold text-ink-900 leading-tight'>{remainingKm} km restantes</p>
                        )}
                    </div>
                </div>
            )}

            {/* Pino central de seleção manual no mapa */}
            {props.isSelectingOnMap && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full z-modal pointer-events-none drop-shadow-2xl flex flex-col items-center">
                    <i className="ri-map-pin-fill text-5xl text-ink-900"></i>
                    <div className="w-3 h-1 bg-black/30 rounded-[100%] absolute bottom-0 shadow-xl blur-[1px]"></div>
                </div>
            )}

            {/* Botão de recentralizar/seguir */}
            {!props.isSelectingOnMap && (
                <button
                    onClick={handleRecenter}
                    aria-label={isFollowing ? "Seguindo motorista" : "Focar no mapa"}
                    className={`absolute bottom-6 right-4 z-panel h-11 w-11 rounded-full shadow-raised flex items-center justify-center border transition-all active:scale-95 ${isFollowing ? 'bg-brand-500 border-brand-500 text-white' : 'bg-surface border-line text-ink-900'}`}
                >
                    <i className="ri-gps-line text-xl" aria-hidden="true"></i>
                </button>
            )}
        </div>
    )
}

// Mapa + rota são o painel mais pesado do app (Leaflet/OSM). Envolto em memo pra não
// re-renderizar à toa quando algo sem relação (toast, painel abrindo/fechando) muda
// no componente pai — item 16 da auditoria de UX.
export default memo(LiveTracking)
