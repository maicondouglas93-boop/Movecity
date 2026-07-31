import React, { useState, useEffect, useRef, useContext, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { SocketContext } from '../context/SocketContext'
import { LocationContext } from '../context/LocationContext'

// Fix default marker icon issue in Leaflet with Webpack/Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

const vehicleIcons = {
    car: L.divIcon({
        html: `
          <div class="flex items-center justify-center h-10 w-10 bg-black text-white rounded-full border-2 border-white shadow-xl">
            <i class="ri-car-fill text-xl"></i>
          </div>
        `,
        className: 'custom-vehicle-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
    }),
    moto: L.divIcon({
        html: `
          <div class="flex items-center justify-center h-10 w-10 bg-black text-white rounded-full border-2 border-white shadow-xl">
            <i class="ri-motorbike-fill text-xl"></i>
          </div>
        `,
        className: 'custom-vehicle-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
    }),
    motorcycle: L.divIcon({
        html: `
          <div class="flex items-center justify-center h-10 w-10 bg-black text-white rounded-full border-2 border-white shadow-xl">
            <i class="ri-motorbike-fill text-xl"></i>
          </div>
        `,
        className: 'custom-vehicle-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
    }),
    auto: L.divIcon({
        html: `
          <div class="flex items-center justify-center h-10 w-10 bg-black text-yellow-400 rounded-full border-2 border-white shadow-xl">
            <i class="ri-taxi-fill text-xl text-yellow-400"></i>
          </div>
        `,
        className: 'custom-vehicle-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
    }),
};

const userPositionIcon = L.divIcon({
    html: `
      <div class="relative flex items-center justify-center h-5 w-5">
        <div class="absolute h-5 w-5 bg-blue-500 rounded-full animate-ping opacity-60"></div>
        <div class="h-3 w-3 bg-blue-600 rounded-full border-2 border-white shadow-md"></div>
      </div>
    `,
    className: 'user-position-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
});

const pickupIcon = L.divIcon({
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:#16a34a;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="14" height="14"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
    `,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
});

const destinationIcon = L.divIcon({
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:#dc2626;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="14" height="14"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
    `,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
});

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
    const mapInstanceRef = useRef(null);
    const markerInstanceRef = useRef(null);
    const captainMarkerInstanceRef = useRef(null);
    const pickupMarkerRef = useRef(null);
    const destinationMarkerRef = useRef(null);
    const routePolylineRef = useRef(null);
    const radiusCircleRef = useRef(null);
    
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
        if (markerInstanceRef.current) {
            markerInstanceRef.current.setLatLng([lat, lng]);
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
                if (pickupMarkerRef.current && mapInstanceRef.current) {
                    mapInstanceRef.current.removeLayer(pickupMarkerRef.current);
                    pickupMarkerRef.current = null;
                }
                if (destinationMarkerRef.current && mapInstanceRef.current) {
                    mapInstanceRef.current.removeLayer(destinationMarkerRef.current);
                    destinationMarkerRef.current = null;
                }
                if (routePolylineRef.current && mapInstanceRef.current) {
                    mapInstanceRef.current.removeLayer(routePolylineRef.current);
                    routePolylineRef.current = null;
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

            if (props.ride) {
                if (props.ride.status === 'accepted') {
                    // Phase 1: Captain heading to Pickup
                    startLat = captainPosition?.lat || props.ride.captain?.location?.ltd || pickupCoords.lat;
                    startLng = captainPosition?.lng || props.ride.captain?.location?.lng || pickupCoords.lng;
                    endLat = pickupCoords.lat;
                    endLng = pickupCoords.lng;
                } else if (props.ride.status === 'ongoing') {
                    // Phase 2: Trip ongoing to Destination
                    startLat = pickupCoords.lat;
                    startLng = pickupCoords.lng;
                    endLat = destinationCoords.lat;
                    endLng = destinationCoords.lng;
                }
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
        if (!hasPosition || !mapRef.current || mapInstanceRef.current) return;

        const pos = currentPositionRef.current;
        if (!pos) return;

        const map = L.map(mapRef.current, {
            zoomControl: false
        }).setView([pos.lat, pos.lng], 15);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        const marker = L.marker([pos.lat, pos.lng], { icon: userPositionIcon }).addTo(map);

        mapInstanceRef.current = map;
        markerInstanceRef.current = marker;

        map.on('moveend', () => {
            if (onMapCenterChangeRef.current) {
                const center = map.getCenter();
                onMapCenterChangeRef.current({ lat: center.lat, lng: center.lng });
            }
        });

        // Fix gray tiles on initial render
        setTimeout(() => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.invalidateSize();
            }
        }, 300);

        // Disable follow mode on user drag/interaction
        map.on('dragstart', () => {
            setIsFollowing(false);
        });
        map.on('zoomstart', () => {
            setIsFollowing(false);
        });

        // Cleanup only on unmount
        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
                markerInstanceRef.current = null;
                captainMarkerInstanceRef.current = null;
                pickupMarkerRef.current = null;
                destinationMarkerRef.current = null;
                routePolylineRef.current = null;
                if (radiusCircleRef.current) {
                    mapInstanceRef.current.removeLayer(radiusCircleRef.current);
                    radiusCircleRef.current = null;
                }
            }
        };
    }, [hasPosition]); // Only when position first becomes available

    // Reset fit bounds flag when route or coordinates change
    useEffect(() => {
        hasFitBoundsRef.current = false;
    }, [pickupCoords, destinationCoords, routeCoords.length]);

    const handleRecenter = useCallback(() => {
        if (!mapInstanceRef.current) return;
        mapInstanceRef.current.invalidateSize();
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
            try {
                const bounds = L.latLngBounds(allCoords);
                mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], animate: true });
                setIsFollowing(true);
            } catch (err) {
                console.warn('Leaflet fitBounds error:', err);
            }
        }
    }, [captainPosition, pickupCoords, destinationCoords]);

    // Update markers and polyline when data changes
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        if (pickupCoords) {
            if (pickupMarkerRef.current) {
                pickupMarkerRef.current.setLatLng([pickupCoords.lat, pickupCoords.lng]);
            } else {
                pickupMarkerRef.current = L.marker([pickupCoords.lat, pickupCoords.lng], {
                    icon: pickupIcon,
                    title: 'Pickup Location'
                }).addTo(mapInstanceRef.current)
                .bindTooltip('Pickup', { permanent: false, direction: 'top' });
            }
        }

        if (destinationCoords) {
            if (destinationMarkerRef.current) {
                destinationMarkerRef.current.setLatLng([destinationCoords.lat, destinationCoords.lng]);
            } else {
                destinationMarkerRef.current = L.marker([destinationCoords.lat, destinationCoords.lng], {
                    icon: destinationIcon,
                    title: 'Destination'
                }).addTo(mapInstanceRef.current)
                .bindTooltip('Destination', { permanent: false, direction: 'top' });
            }
        }

        if (routeCoords.length > 0) {
            const remainingRoute = getRemainingRoute(routeCoords, captainPosition);
            if (routePolylineRef.current) {
                routePolylineRef.current.setLatLngs(remainingRoute);
            } else {
                routePolylineRef.current = L.polyline(remainingRoute, {
                    color: '#111111', // Uber black route line
                    weight: 6,
                    opacity: 0.9
                }).addTo(mapInstanceRef.current);
            }

            // Fit map bounds once
            if (!hasFitBoundsRef.current) {
                const allCoords = [...routeCoords];
                const capCoord = sanitizeCoord(captainPosition?.lat, captainPosition?.lng);
                if (capCoord) allCoords.push([capCoord.lat, capCoord.lng]);
                
                try {
                    const bounds = L.latLngBounds(allCoords);
                    mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], animate: true });
                    hasFitBoundsRef.current = true;
                } catch (err) {
                    console.warn('Leaflet fitBounds error:', err);
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
                    try {
                        const bounds = L.latLngBounds(boundsCoords);
                        mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], animate: true });
                        hasFitBoundsRef.current = true;
                    } catch (err) {
                        console.warn('Leaflet fitBounds error:', err);
                    }
                }
            }
        }
    }, [pickupCoords, destinationCoords, routeCoords, captainPosition]);

    // Update captain position marker smoothly with linear interpolation
    useEffect(() => {
        if (!mapInstanceRef.current || !captainPosition) return;

        const startLat = prevCaptainPosRef.current ? prevCaptainPosRef.current.lat : captainPosition.lat;
        const startLng = prevCaptainPosRef.current ? prevCaptainPosRef.current.lng : captainPosition.lng;
        const endLat = captainPosition.lat;
        const endLng = captainPosition.lng;

        prevCaptainPosRef.current = captainPosition;

        const vType = props.ride?.vehicleType || props.ride?.captain?.vehicle?.vehicleType || props.vehicleType || 'car';
        const selectedIcon = vehicleIcons[vType] || vehicleIcons.car;

        // If it's the first time placing the captain marker
        if (!captainMarkerInstanceRef.current) {
            captainMarkerInstanceRef.current = L.marker([endLat, endLng], { icon: selectedIcon }).addTo(mapInstanceRef.current);
            return;
        } else {
            captainMarkerInstanceRef.current.setIcon(selectedIcon);
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

            if (captainMarkerInstanceRef.current) {
                captainMarkerInstanceRef.current.setLatLng([currentLat, currentLng]);
                
                if (props.showSearchRadius && mapInstanceRef.current) {
                    if (!radiusCircleRef.current) {
                        radiusCircleRef.current = L.circle([currentLat, currentLng], {
                            color: '#3b82f6', // Tailwind blue-500
                            fillColor: '#3b82f6',
                            fillOpacity: 0.08,
                            radius: 3000, // 3km radius
                            weight: 1.5,
                            dashArray: '5, 5'
                        }).addTo(mapInstanceRef.current);
                    } else {
                        radiusCircleRef.current.setLatLng([currentLat, currentLng]);
                    }
                }

                // Auto pan if follow mode is active
                if (isFollowing && mapInstanceRef.current) {
                    mapInstanceRef.current.panTo([currentLat, currentLng], { animate: false });
                }
            }

            // Prune the route polyline smoothly on each animation frame
            if (routePolylineRef.current && routeCoordsRef.current.length > 0) {
                const remainingRoute = getRemainingRoute(routeCoordsRef.current, { lat: currentLat, lng: currentLng });
                routePolylineRef.current.setLatLngs(remainingRoute);
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

    const ridePhaseLabel = props.ride?.status === 'accepted'
        ? 'Captain heading to pickup'
        : props.ride?.status === 'ongoing'
        ? 'Ride in progress'
        : null;

    const remainingKm = routeCoords.length > 1 && captainPosition
        ? calculateRouteDistance(getRemainingRoute(routeCoords, captainPosition)).toFixed(1)
        : null;

    if (!hasPosition) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-gray-100">
                <div className="flex flex-col items-center gap-2">
                    <i className="ri-map-pin-line text-3xl text-gray-400 animate-bounce"></i>
                    <p className="text-gray-500 font-medium">Obtendo localização...</p>
                </div>
            </div>
        );
    }

    return (
        <div className='relative w-full h-full'>
            <div ref={mapRef} style={{ width: '100%', height: '100%', zIndex: 0 }} />

            {/* Uber-style ETA + route status HUD chip at the top */}
            {ridePhaseLabel && !props.isSelectingOnMap && (
                <div className='absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-white rounded-full shadow-xl px-5 py-2.5 border border-gray-100'>
                    <div className='h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse flex-shrink-0'></div>
                    <div>
                        <p className='text-xs text-gray-500 leading-tight'>{ridePhaseLabel}</p>
                        {remainingKm && (
                            <p className='text-sm font-bold text-black leading-tight'>{remainingKm} km remaining</p>
                        )}
                    </div>
                </div>
            )}

            {/* Map Selection Center Pin */}
            {props.isSelectingOnMap && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full z-[9999] pointer-events-none drop-shadow-2xl flex flex-col items-center">
                    <i className="ri-map-pin-fill text-5xl text-black"></i>
                    <div className="w-3 h-1 bg-black/30 rounded-[100%] absolute bottom-0 shadow-xl blur-[1px]"></div>
                </div>
            )}

            {/* Re-center / Focus button styled like Uber's native button */}
            {!props.isSelectingOnMap && (
                <button 
                    onClick={handleRecenter}
                    className={`absolute bottom-6 right-4 z-20 h-11 w-11 rounded-full shadow-xl flex items-center justify-center border border-gray-100 hover:scale-105 active:scale-95 transition-all ${isFollowing ? 'bg-blue-600 text-white' : 'bg-white text-black'}`}
                    title={isFollowing ? "Seguindo motorista" : "Focar no mapa"}
                >
                    <i className="ri-gps-line text-xl"></i>
                </button>
            )}
        </div>
    )
}

export default LiveTracking