import React, { useState, useEffect, useRef, useContext, useCallback, memo } from 'react'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { createMapProvider } from '@/shared/services/maps'
import EmptyState from '@/shared/components/ui/EmptyState'
import api from '@/shared/services/axios'
import { getAccessToken } from '@/shared/services/session'
import {
    addressFromInput,
    coordFromInput,
    sanitizeCoord,
} from '@/shared/services/maps/parseLocation'
import {
    cameraCenterForFollow,
    computeBearing,
    distanceMeters,
    dynamicZoom,
    lerp,
    lerpAngle,
    pickNextStep,
    shortestAngleDelta,
} from '@/shared/services/maps/navigationMath'

// ====== Fase D da experiência de corrida ativa (2026-08-03) ======
// Inclinação da câmera em navegação. 55° é o patamar em que a via à frente ganha
// profundidade sem que o horizonte engula metade da tela (acima de ~62° o Google
// começa a mostrar mais céu que rua).
const NAV_TILT = 55;
// Fração do estado que se aproxima do alvo a cada quadro. Com ~60 fps converge em
// meio segundo: rápido o bastante para acompanhar uma curva, lento o bastante para
// não transformar cada fix de GPS num tranco.
const NAV_SMOOTHING = 0.12;
// Abaixo destes limiares a câmera já chegou no alvo e o loop de animação PARA — é o
// que impede um requestAnimationFrame rodando a 60 fps o tempo todo com o veículo
// parado, que é onde um mapa de navegação queima bateria à toa.
const NAV_EPSILON_DEG = 0.15;
const NAV_EPSILON_ZOOM = 0.01;
const NAV_EPSILON_M = 0.5;
// Distância da rota a partir da qual se considera que o motorista saiu do caminho.
const REROUTE_DISTANCE_M = 70;
// Intervalo mínimo entre recálculos de rota — o endpoint tem custo por chamada e um
// GPS instável não pode disparar uma rota nova por segundo.
const REROUTE_MIN_INTERVAL_MS = 20000;
// Zoom da Home (passageiro/motorista) ao obter o GPS: visão de bairro/cidade (~2–4 km),
// não rua. Antes o fitBounds com 1 ponto ia ao zoom máximo e “grudava” no pino.
const IDLE_MAP_ZOOM = 14;
// Teto ao enquadrar rota/pickup/destino — evita zoom de rua em trajetos curtos.
const FIT_BOUNDS_MAX_ZOOM = 15;

const focusMapOnCoords = (provider, coords, { padding = [50, 50], animate = true } = {}) => {
    if (!provider || !coords?.length) return false;

    const points = [];
    const seen = new Set();
    for (const c of coords) {
        const lat = Array.isArray(c) ? c[0] : c?.lat;
        const lng = Array.isArray(c) ? c[1] : c?.lng;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        points.push([lat, lng]);
    }
    if (points.length === 0) return false;

    if (points.length === 1) {
        provider.moveCamera({
            center: { lat: points[0][0], lng: points[0][1] },
            zoom: IDLE_MAP_ZOOM,
        });
        return true;
    }

    return provider.fitBounds(points, { padding, animate, maxZoom: FIT_BOUNDS_MAX_ZOOM });
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

    // §12 do relatório de UX: quando provider.init() falhava, o mapa ficava em branco
    // sem nenhuma explicação nem forma de tentar de novo — só um console.error. retryKey
    // força o efeito de inicialização a rodar de novo mesmo sem `hasPosition` mudar.
    const [ mapError, setMapError ] = useState(false);
    const [ retryKey, setRetryKey ] = useState(0);

    // Fase C (2026-08-03): providerRef é um ref — não re-renderiza quando o init
    // assíncrono termina. A camada de motoristas disponíveis precisa de um sinal
    // reativo de "mapa pronto" pra montar depois do provider existir.
    const [ mapReady, setMapReady ] = useState(false);

    // Fase C: motoristas disponíveis no mapa do passageiro. Map por driverId
    // (atualização incremental — nunca recria a lista inteira) e um único loop de
    // rAF interpolando todos os marcadores com animação pendente, pra escalar pra
    // centenas de motoristas sem um loop por marcador.
    const driversRef = useRef(new Map()); // driverId -> { current, from, target, startTime, vehicleType, heading }
    const driversAnimRef = useRef(null);

    // Fase D (2026-08-03): estado do modo navegação.
    // navStateRef é o que está NA TELA agora; navTargetRef é para onde a câmera está
    // indo. O loop de animação aproxima um do outro — é essa separação que produz o
    // movimento suave em vez de um salto por fix de GPS.
    const [ routeSteps, setRouteSteps ] = useState([]);
    const [ routeVersion, setRouteVersion ] = useState(0);
    const routeSummaryRef = useRef(null); // { distanceValue, durationValue }
    const navStateRef = useRef({ position: null, heading: 0, zoom: 17 });
    const navTargetRef = useRef({ position: null, heading: 0, zoom: 17 });
    const navAnimRef = useRef(null);
    const navStepIndexRef = useRef(0);
    const lastRouteFetchRef = useRef(0);
    const offRouteSinceRef = useRef(null);
    const lastPrunedPositionRef = useRef(null);
    const onNavigationUpdateRef = useRef(props.onNavigationUpdate);

    // Keep routeCoordsRef in sync
    useEffect(() => {
        routeCoordsRef.current = routeCoords;
    }, [routeCoords]);

    useEffect(() => {
        onMapCenterChangeRef.current = props.onMapCenterChange;
    }, [props.onMapCenterChange]);

    useEffect(() => {
        onNavigationUpdateRef.current = props.onNavigationUpdate;
    }, [props.onNavigationUpdate]);

    // GPS tracking sync from Global Context
    useEffect(() => {
        if (!userLocation) return;
        const { lat, lng } = userLocation;

        currentPositionRef.current = { lat, lng, heading: userLocation.heading, speed: userLocation.speed };

        // Update marker position directly. Em navegação o veículo é representado pelo
        // marcador 'navigator' (seta que gira) — manter também o ponto azul de "você
        // está aqui" mostraria dois marcadores sobrepostos na mesma coordenada.
        if (providerRef.current && !props.navigationMode) {
            providerRef.current.placeMarker('user', { lat, lng }, { type: 'user' });
        }

        // Signal that we have a position (only once, to trigger map init)
        if (!hasPosition) {
            setHasPosition(true);
        }
    }, [userLocation]); // Syncs automatically when global location updates

    const rideIsTerminal = ['finished', 'cancelled'].includes(props.ride?.status);
    const shouldClearTrip = Boolean(props.clearTrip) || rideIsTerminal;

    // Initialize captain position from ride details if available
    useEffect(() => {
        if (shouldClearTrip) return;
        if (props.ride?.captain?.location?.ltd && props.ride?.captain?.location?.lng) {
            const newPos = {
                lat: props.ride.captain.location.ltd,
                lng: props.ride.captain.location.lng
            };
            setCaptainPosition(newPos);
        }
    }, [props.ride, shouldClearTrip]);

    // Pós-corrida (2026-08-04): remove polyline/markers na fonte — esconder a rota no
    // CSS deixava o estado vivo e a Home redesenhava o trajeto fantasma.
    useEffect(() => {
        if (!shouldClearTrip) return;

        setPickupCoords(null);
        setDestinationCoords(null);
        setRouteCoords([]);
        setRouteSteps([]);
        setCaptainPosition(null);
        prevCaptainPosRef.current = null;
        hasFitBoundsRef.current = false;
        hasCaptainMarkerRef.current = false;
        routeSummaryRef.current = null;

        if (providerRef.current) {
            providerRef.current.removeMarker('pickup');
            providerRef.current.removeMarker('destination');
            providerRef.current.removeMarker('captain');
            providerRef.current.removeRoute();
        }
    }, [shouldClearTrip, props.ride?._id, props.ride?.status, props.clearTrip]);

    // Listen for real-time captain location updates — só em corrida ativa.
    useEffect(() => {
        if (!socket || shouldClearTrip) return;

        const handleCaptainLocationUpdated = (data) => {
            if (!data || data.ltd == null || data.lng == null) return;
            // Ignora updates de outra corrida/encomenda quando o payload traz id.
            if (props.ride?._id && data.rideId && String(data.rideId) !== String(props.ride._id)) {
                return;
            }
            if (props.parcelId && data.parcelId && String(data.parcelId) !== String(props.parcelId)) {
                return;
            }
            setCaptainPosition({
                lat: data.ltd,
                lng: data.lng
            });
        };

        socket.on('captain-location-updated', handleCaptainLocationUpdated);

        return () => {
            socket.off('captain-location-updated', handleCaptainLocationUpdated);
        };
    }, [socket, shouldClearTrip, props.ride?._id, props.parcelId]);

    // Initialize pickup and destination coordinates from props/ride
    useEffect(() => {
        const fetchCoords = async () => {
            if (shouldClearTrip) {
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

            const resolveCoord = async (input, known) => {
                const local = coordFromInput(known) || coordFromInput(input);
                if (local) return local;
                const address = addressFromInput(input);
                if (!address || address.length < 3) return null;
                // api (@/shared/services/axios) renova token em 401 — fetch cru não.
                const { data } = await api.get('/maps/get-coordinates', { params: { address } });
                return sanitizeCoord(data.ltd, data.lng);
            };

            try {
                if (activePickup) {
                    const coord = await resolveCoord(activePickup, props.ride?.pickupCoordinates);
                    if (coord) setPickupCoords(coord);
                }
                if (activeDestination) {
                    const coord = await resolveCoord(activeDestination, props.ride?.destinationCoordinates);
                    if (coord) setDestinationCoords(coord);
                }
            } catch (err) {
                console.error('Error fetching coords:', err);
            }
        };

        const debounceTimer = setTimeout(() => {
            fetchCoords();
        }, 800);

        return () => clearTimeout(debounceTimer);
    }, [props.ride, props.pickup, props.destination, shouldClearTrip]);

    // Busca a rota conforme a fase da corrida.
    // Fase D (2026-08-03): passou a usar GET /maps/get-route em vez de chamar o
    // router.project-osrm.org público direto do navegador. Aquilo furava a regra de o
    // backend ser a única fonte da verdade, ficava fora do cache do servidor, dependia
    // de um serviço de demonstração sem SLA e — o que impedia a navegação — não trazia
    // as manobras. O endpoint novo devolve polyline + steps normalizados.
    useEffect(() => {
        const fetchRoute = async () => {
            if (shouldClearTrip) return;
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

            // Em navegação quem guia é o GPS real do próprio motorista: a rota parte de
            // onde ele está agora, não do ponto de embarque de minutos atrás. É também
            // o que permite o recálculo quando ele sai do caminho.
            if (props.navigationMode) {
                const own = currentPositionRef.current;
                if (own) {
                    startLat = own.lat;
                    startLng = own.lng;
                }
            }

            const fallbackLine = [[startLat, startLng], [endLat, endLng]];
            if (!getAccessToken('user') && !getAccessToken('captain')) {
                setRouteCoords(fallbackLine);
                return;
            }

            lastRouteFetchRef.current = Date.now();

            try {
                // toFixed(6) garante o ponto decimal que o parser de "lat,lng" do backend
                // exige (uma coordenada inteira cairia no geocoder e viraria endereço).
                const origin = `${startLat.toFixed(6)},${startLng.toFixed(6)}`;
                const destination = `${endLat.toFixed(6)},${endLng.toFixed(6)}`;
                const { data } = await api.get('/maps/get-route', {
                    params: { origin, destination }
                });

                setRouteCoords(Array.isArray(data.polyline) && data.polyline.length > 0 ? data.polyline : fallbackLine);
                setRouteSteps(Array.isArray(data.steps) ? data.steps : []);
                routeSummaryRef.current = {
                    distanceValue: data.distance?.value ?? null,
                    durationValue: data.duration?.value ?? null,
                };
                navStepIndexRef.current = 0;
                offRouteSinceRef.current = null;
                // Rota nova: a poda precisa rodar já no próximo quadro, sem esperar os
                // 3 m de deslocamento — senão o traçado antigo fica na tela.
                lastPrunedPositionRef.current = null;
            } catch (err) {
                console.error('Erro ao buscar rota:', err);
                setRouteCoords(fallbackLine);
                setRouteSteps([]);
            }
        };

        fetchRoute();
        // routeVersion é o gatilho do recálculo por desvio de rota (modo navegação).
    }, [pickupCoords, destinationCoords, props.ride?.status, routeVersion, shouldClearTrip, props.navigationMode]);

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
            zoom: IDLE_MAP_ZOOM,
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
                setMapError(false);
                setMapReady(true);
            }
        }).catch((err) => {
            console.error('Falha ao inicializar o provider de mapa:', err);
            if (!cancelled) setMapError(true);
        });

        // Cleanup only on unmount
        return () => {
            cancelled = true;
            if (providerRef.current) {
                providerRef.current.destroy();
                providerRef.current = null;
                hasCaptainMarkerRef.current = false;
                setMapReady(false);
            }
        };
    }, [hasPosition, retryKey]); // Only when position first becomes available (ou retry manual)

    const handleRetryMap = useCallback(() => {
        setMapError(false);
        setRetryKey(k => k + 1);
    }, []);

    // ====== Fase C (2026-08-03): motoristas disponíveis em tempo real ======
    // Mesma filosofia do RideContext: o snapshot REST (GET /maps/nearby-drivers)
    // reconstrói o estado completo — na montagem, no reconnect do socket e na volta do
    // background — e os eventos de socket (driver-location/busy/offline) só aplicam
    // atualizações incrementais. Ativo apenas quando props.showNearbyDrivers é true
    // (Home do passageiro sem corrida aceita); telas do motorista não ligam a camada.
    useEffect(() => {
        const clearAllDrivers = () => {
            if (driversAnimRef.current) {
                cancelAnimationFrame(driversAnimRef.current);
                driversAnimRef.current = null;
            }
            for (const id of driversRef.current.keys()) {
                providerRef.current?.removeMarker(`driver_${id}`);
            }
            driversRef.current.clear();
        };

        if (!props.showNearbyDrivers || !mapReady || !socket) {
            clearAllDrivers();
            return;
        }

        // Casada com a frequência real de emissão do motorista (~10s): desliza o
        // marcador por 2s em vez de teleportar a cada update.
        const ANIMATION_MS = 2000;

        // Limiares da direção do marcador. Abaixo de 8m o deslocamento é indistinguível
        // de deriva do GPS e o rumo calculado seria ruído puro; abaixo de 12° a mudança
        // não é perceptível e só custaria um redesenho de ícone.
        const MIN_BEARING_DISTANCE_M = 8;
        const MIN_BEARING_CHANGE_DEG = 12;

        const ensureAnimationLoop = () => {
            if (driversAnimRef.current) return;
            const step = (now) => {
                let pending = false;
                for (const [id, driver] of driversRef.current) {
                    if (!driver.target) continue;
                    const progress = Math.min((now - driver.startTime) / ANIMATION_MS, 1);
                    driver.current = {
                        lat: driver.from.lat + (driver.target.lat - driver.from.lat) * progress,
                        lng: driver.from.lng + (driver.target.lng - driver.from.lng) * progress
                    };
                    providerRef.current?.moveMarker(`driver_${id}`, driver.current);
                    if (progress < 1) pending = true;
                    else driver.target = null;
                }
                driversAnimRef.current = pending ? requestAnimationFrame(step) : null;
            };
            driversAnimRef.current = requestAnimationFrame(step);
        };

        const upsertDriver = ({ driverId, vehicleType, location }) => {
            const pos = sanitizeCoord(location?.ltd, location?.lng);
            if (!driverId || !pos || !providerRef.current) return;
            const id = String(driverId);
            const existing = driversRef.current.get(id);
            if (!existing) {
                driversRef.current.set(id, { current: pos, from: pos, target: null, startTime: 0, vehicleType, heading: null });
                providerRef.current.placeMarker(`driver_${id}`, pos, { type: vehicleType || 'car' });
                return;
            }
            if (vehicleType && existing.vehicleType !== vehicleType) {
                existing.vehicleType = vehicleType;
                providerRef.current.setMarkerIcon(`driver_${id}`, vehicleType);
                // Trocar o ícone recria o elemento no Leaflet e leva junto a rotação
                // aplicada por CSS; reaplica para o ponteiro não sumir.
                if (existing.heading != null) providerRef.current.setMarkerRotation(`driver_${id}`, existing.heading);
            }

            // Direção pelo delta entre posições: o backend só manda coordenada, e o
            // heading do GPS do motorista não trafega neste evento.
            const moved = distanceMeters(existing.current, pos);
            if (moved != null && moved >= MIN_BEARING_DISTANCE_M) {
                const bearing = computeBearing(existing.current, pos);
                if (bearing != null
                    && (existing.heading == null || Math.abs(shortestAngleDelta(bearing, existing.heading)) >= MIN_BEARING_CHANGE_DEG)) {
                    existing.heading = bearing;
                    providerRef.current.setMarkerRotation(`driver_${id}`, bearing);
                }
            }

            existing.from = existing.current;
            existing.target = pos;
            existing.startTime = performance.now();
            ensureAnimationLoop();
        };

        const removeDriver = (driverId) => {
            if (driverId == null) return;
            const id = String(driverId);
            if (!driversRef.current.has(id)) return;
            driversRef.current.delete(id);
            providerRef.current?.removeMarker(`driver_${id}`);
        };

        const syncDrivers = async () => {
            const pos = currentPositionRef.current;
            const token = getAccessToken('user');
            if (!pos || !token) return;
            try {
                const response = await fetch(
                    `${import.meta.env.VITE_BASE_URL}/maps/nearby-drivers?lat=${pos.lat}&lng=${pos.lng}`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                if (!response.ok) return;
                const drivers = await response.json();
                if (!Array.isArray(drivers)) return;
                // Reconciliação incremental: remove quem saiu, atualiza/insere o resto.
                const seen = new Set(drivers.map(d => String(d.id)));
                for (const id of [...driversRef.current.keys()]) {
                    if (!seen.has(id)) removeDriver(id);
                }
                drivers.forEach(d => upsertDriver({ driverId: d.id, vehicleType: d.vehicleType, location: d.location }));
            } catch (err) {
                console.error('Erro ao sincronizar motoristas próximos:', err);
            }
        };

        const subscribe = () => {
            const token = getAccessToken('user');
            if (token) socket.emit('subscribe-drivers-map', { token });
        };

        const handleDriverLocation = (data) => upsertDriver(data || {});
        const handleDriverGone = (data) => removeDriver(data?.driverId);
        const handleConnect = () => {
            // Reconexão zera as rooms no servidor — reentra e refaz o snapshot
            // (eventos perdidos durante a queda não são reenviados).
            subscribe();
            syncDrivers();
        };
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                subscribe();
                syncDrivers();
            }
        };

        subscribe();
        syncDrivers();
        socket.on('connect', handleConnect);
        socket.on('driver-location', handleDriverLocation);
        socket.on('driver-busy', handleDriverGone);
        socket.on('driver-offline', handleDriverGone);
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            if (socket.connected) socket.emit('unsubscribe-drivers-map');
            socket.off('connect', handleConnect);
            socket.off('driver-location', handleDriverLocation);
            socket.off('driver-busy', handleDriverGone);
            socket.off('driver-offline', handleDriverGone);
            document.removeEventListener('visibilitychange', handleVisibility);
            clearAllDrivers();
        };
    }, [props.showNearbyDrivers, mapReady, socket]);

    // ====== Fase D (2026-08-03): câmera de navegação estilo Waze/Google Maps ======
    // Duas responsabilidades separadas de propósito:
    //   1) este efeito mantém o LOOP de animação (interpola posição/rumo/zoom do que
    //      está na tela em direção ao alvo, quadro a quadro);
    //   2) o efeito seguinte, disparado a cada fix de GPS, apenas move o ALVO.
    // Misturar os dois é o que produz o mapa que "pula" a cada GPS.
    const navKickRef = useRef(null);

    useEffect(() => {
        if (!props.navigationMode || !mapReady) {
            return;
        }

        const provider = providerRef.current;
        if (!provider) return;

        // O ponto azul de posição e o marcador de veículo da fase anterior sairiam
        // sobrepostos exatamente sob a seta de navegação.
        provider.removeMarker('user');
        provider.removeMarker('captain');
        hasCaptainMarkerRef.current = false;

        const start = currentPositionRef.current;
        if (start) {
            navStateRef.current = {
                position: { lat: start.lat, lng: start.lng },
                heading: Number.isFinite(start.heading) ? start.heading : 0,
                zoom: 17,
            };
            navTargetRef.current = { ...navStateRef.current };
            provider.placeMarker('navigator', navStateRef.current.position, { type: 'navigator' });
            provider.setMarkerRotation('navigator', navStateRef.current.heading);
        }

        let cancelled = false;

        const frame = () => {
            navAnimRef.current = null;
            if (cancelled || !providerRef.current) return;

            const state = navStateRef.current;
            const target = navTargetRef.current;
            if (!target.position) return;
            if (!state.position) state.position = { ...target.position };

            const headingDelta = shortestAngleDelta(state.heading, target.heading);
            const zoomDelta = target.zoom - state.zoom;
            const positionDelta = distanceMeters(state.position, target.position) ?? 0;

            state.position = {
                lat: lerp(state.position.lat, target.position.lat, NAV_SMOOTHING),
                lng: lerp(state.position.lng, target.position.lng, NAV_SMOOTHING),
            };
            state.heading = lerpAngle(state.heading, target.heading, NAV_SMOOTHING);
            state.zoom = lerp(state.zoom, target.zoom, NAV_SMOOTHING);

            providerRef.current.moveMarker('navigator', state.position);
            providerRef.current.setMarkerRotation('navigator', state.heading);
            providerRef.current.moveCamera({
                // O veículo fica no terço inferior porque a câmera mira um ponto à
                // FRENTE dele — assim a tela mostra a rua que vem, não a que já passou.
                center: cameraCenterForFollow({
                    position: state.position,
                    heading: state.heading,
                    zoom: state.zoom,
                    viewportHeightPx: mapRef.current?.clientHeight || 0,
                }),
                heading: state.heading,
                tilt: NAV_TILT,
                zoom: state.zoom,
            });

            // Consome a rota atrás do veículo enquanto ele avança. Só recalcula a
            // cada 3 m percorridos: a poda varre a polyline inteira (milhares de
            // pontos numa viagem longa) e refazer isso a 60 fps é trabalho jogado
            // fora — o traçado nem muda visivelmente em deslocamentos menores.
            if (routeCoordsRef.current.length > 0) {
                const lastPruned = lastPrunedPositionRef.current;
                if (!lastPruned || (distanceMeters(lastPruned, state.position) ?? 0) > 3) {
                    lastPrunedPositionRef.current = state.position;
                    providerRef.current.setRoute(getRemainingRoute(routeCoordsRef.current, state.position));
                }
            }

            const converged = Math.abs(headingDelta) < NAV_EPSILON_DEG
                && Math.abs(zoomDelta) < NAV_EPSILON_ZOOM
                && positionDelta < NAV_EPSILON_M;

            // Parar ao convergir é o que separa esta tela de um rAF eterno a 60 fps:
            // com o veículo parado no semáforo o loop simplesmente não roda.
            if (!converged) {
                navAnimRef.current = requestAnimationFrame(frame);
            }
        };

        const kick = () => {
            // Em segundo plano o navegador congela o rAF de qualquer forma; não agendar
            // evita acumular um quadro pendente que dispararia em rajada na volta.
            if (cancelled || document.hidden || navAnimRef.current) return;
            navAnimRef.current = requestAnimationFrame(frame);
        };
        navKickRef.current = kick;

        const handleVisibility = () => {
            if (document.visibilityState !== 'visible') return;
            // Voltou do background: a posição do alvo pode estar muito à frente do que
            // está na tela. Interpolar dali produziria um voo longo — salta direto.
            const target = navTargetRef.current;
            if (target.position) {
                navStateRef.current = { position: { ...target.position }, heading: target.heading, zoom: target.zoom };
            }
            kick();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        kick();

        return () => {
            cancelled = true;
            navKickRef.current = null;
            document.removeEventListener('visibilitychange', handleVisibility);
            if (navAnimRef.current) {
                cancelAnimationFrame(navAnimRef.current);
                navAnimRef.current = null;
            }
            providerRef.current?.removeMarker('navigator');
            // Devolve a câmera ao estado top-down para quem for usar o mapa depois.
            providerRef.current?.moveCamera({ heading: 0, tilt: 0 });
        };
    }, [props.navigationMode, mapReady]);

    // Fase D: a cada fix de GPS real, recalcula o ALVO da câmera e a próxima manobra.
    // Roda por fix (~1/s), nunca por quadro — bearing, zoom e busca de manobra são
    // decisões, não animação.
    useEffect(() => {
        if (!props.navigationMode || !userLocation) return;

        const position = { lat: userLocation.lat, lng: userLocation.lng };
        const heading = Number.isFinite(userLocation.heading)
            ? userLocation.heading
            : navTargetRef.current.heading;

        const { index, step, distanceMeters: distanceToStep } = pickNextStep(
            routeSteps,
            position,
            navStepIndexRef.current
        );
        navStepIndexRef.current = index;

        navTargetRef.current = {
            position,
            heading,
            zoom: dynamicZoom({ speedMps: userLocation.speed, distanceToManeuverM: distanceToStep }),
        };
        navKickRef.current?.();

        const remaining = routeCoordsRef.current.length > 1
            ? getRemainingRoute(routeCoordsRef.current, position)
            : [];
        const remainingKm = remaining.length > 1 ? calculateRouteDistance(remaining) : null;

        // ETA proporcional: a duração que o roteador devolveu, escalada pela fração da
        // rota que ainda falta. Não é trânsito ao vivo, mas acompanha o progresso real
        // em vez de exibir para sempre a estimativa do início da viagem.
        const summary = routeSummaryRef.current;
        let etaMinutes = null;
        if (remainingKm != null && summary?.durationValue && summary?.distanceValue > 0) {
            const fraction = Math.min(1, (remainingKm * 1000) / summary.distanceValue);
            etaMinutes = Math.max(1, Math.round((summary.durationValue * fraction) / 60));
        }

        onNavigationUpdateRef.current?.({
            step,
            distanceToStepM: distanceToStep,
            remainingKm,
            etaMinutes,
            supportsCamera: providerRef.current?.supportsCamera?.() ?? false,
        });

        // Recálculo por desvio: só quando ele persiste entre fixes consecutivos, para
        // que um único salto de GPS (comum entre prédios altos) não peça rota nova.
        if (routeCoordsRef.current.length > 1) {
            let nearest = Infinity;
            for (const [lat, lng] of routeCoordsRef.current) {
                const d = distanceMeters(position, { lat, lng });
                if (d != null && d < nearest) nearest = d;
            }
            if (nearest > REROUTE_DISTANCE_M) {
                if (offRouteSinceRef.current == null) {
                    offRouteSinceRef.current = Date.now();
                } else if (Date.now() - lastRouteFetchRef.current > REROUTE_MIN_INTERVAL_MS) {
                    offRouteSinceRef.current = null;
                    setRouteVersion(v => v + 1);
                }
            } else {
                offRouteSinceRef.current = null;
            }
        }
    }, [userLocation, routeSteps, props.navigationMode]);

    // Reset fit bounds flag when route or coordinates change
    useEffect(() => {
        hasFitBoundsRef.current = false;
    }, [pickupCoords, destinationCoords, routeCoords.length]);

    const handleRecenter = useCallback(() => {
        if (!providerRef.current) return;
        providerRef.current.invalidateSize();

        // Fase D: em navegação "recentralizar" significa voltar a seguir o veículo (o
        // motorista arrastou o mapa pra espiar algo à frente), não enquadrar a rota
        // inteira — um fitBounds aqui jogaria a câmera para uma visão de cidade.
        if (props.navigationMode) {
            const target = navTargetRef.current;
            if (target.position) {
                navStateRef.current = { position: { ...target.position }, heading: target.heading, zoom: target.zoom };
                navKickRef.current?.();
            }
            setIsFollowing(true);
            return;
        }

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
            if (focusMapOnCoords(providerRef.current, allCoords, { padding: [50, 50], animate: true })) {
                setIsFollowing(true);
            }
        }
    }, [captainPosition, pickupCoords, destinationCoords, props.navigationMode]);

    // Update markers and polyline when data changes
    useEffect(() => {
        if (!providerRef.current) return;

        if (pickupCoords) {
            providerRef.current.placeMarker('pickup', pickupCoords, { type: 'pickup', title: 'Pickup Location', tooltip: 'Pickup' });
        }

        if (destinationCoords) {
            providerRef.current.placeMarker('destination', destinationCoords, { type: 'destination', title: 'Destination', tooltip: 'Destination' });
        }

        // Fase D: em navegação, quem controla traçado e câmera é o loop de navegação
        // (que usa o GPS do próprio motorista). Deixar este efeito também dar
        // fitBounds faria a câmera saltar para uma visão geral no meio da curva.
        const navigating = props.navigationMode;

        if (routeCoords.length > 0) {
            if (!navigating) {
                providerRef.current.setRoute(getRemainingRoute(routeCoords, captainPosition));
            }

            // Fit map bounds once
            if (!hasFitBoundsRef.current && !navigating) {
                const allCoords = [...routeCoords];
                const capCoord = sanitizeCoord(captainPosition?.lat, captainPosition?.lng);
                if (capCoord) allCoords.push([capCoord.lat, capCoord.lng]);

                if (focusMapOnCoords(providerRef.current, allCoords, { padding: [50, 50], animate: true })) {
                    hasFitBoundsRef.current = true;
                }
            }
        } else {
            // Fit default bounds once
            if (!hasFitBoundsRef.current && !navigating) {
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
                    if (focusMapOnCoords(providerRef.current, boundsCoords, { padding: [50, 50], animate: true })) {
                        hasFitBoundsRef.current = true;
                    }
                }
            }
        }
    }, [pickupCoords, destinationCoords, routeCoords, captainPosition, props.navigationMode]);

    // Update captain position marker smoothly with linear interpolation
    useEffect(() => {
        if (!providerRef.current || !captainPosition) return;
        if (shouldClearTrip) return;
        // Fase D: na tela do motorista em navegação, 'captainPosition' é a posição DELE
        // mesmo voltando pelo socket — desenhar esse marcador criaria um segundo
        // veículo, atrasado, brigando com a seta de navegação pela câmera.
        if (props.navigationMode) return;

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
    }, [captainPosition, props.navigationMode, props.vehicleType, props.ride?.vehicleType, props.ride?.captain?.vehicle?.vehicleType, shouldClearTrip]);

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

    if (mapError) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-surface-alt">
                <EmptyState
                    variant="error"
                    icon="ri-map-2-line"
                    title="Não foi possível carregar o mapa"
                    description="Verifique sua conexão e tente novamente."
                    actionLabel="Tentar de novo"
                    onAction={handleRetryMap}
                />
            </div>
        );
    }

    return (
        <div className='relative w-full h-full'>
            <div ref={mapRef} style={{ width: '100%', height: '100%', zIndex: 0 }} />

            {/* Chip de status/progresso da corrida no topo do mapa. Em navegação ele dá
                lugar ao banner de próxima manobra, que a tela do motorista renderiza. */}
            {ridePhaseLabel && !props.isSelectingOnMap && !props.navigationMode && (
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
