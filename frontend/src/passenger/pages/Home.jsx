import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import api from '@/shared/services/axios';
import { devLog, devError } from '@/shared/utils/devLog';
import 'remixicon/fonts/remixicon.css'
import LocationSearchPanel from '@/passenger/components/LocationSearchPanel';
import VehiclePanel from '@/passenger/components/VehiclePanel';
import ConfirmRide from '@/passenger/components/ConfirmRide';
import OptionalsPanel from '@/passenger/components/OptionalsPanel';
import PaymentOptionsPanel from '@/passenger/components/PaymentOptionsPanel';
import LookingForDriver from '@/passenger/components/LookingForDriver';
import WaitingForDriver from '@/passenger/components/WaitingForDriver';
import { SocketContext } from '@/shared/contexts/SocketContext';
import { useContext } from 'react';
import { UserDataContext } from '@/passenger/contexts/UserContext';
import { RideContext } from '@/shared/contexts/RideContext';
import { useNavigate, useLocation } from 'react-router-dom';
import LiveTracking from '@/shared/components/LiveTracking'
import { LocationContext } from '@/shared/contexts/LocationContext';
import { useToast } from '@/shared/contexts/ToastContext';
import Header from '@/passenger/components/Header';
import { requestFCMToken, onForegroundMessage } from '@/shared/services/fcm';
import { reverseGeocode } from '@/shared/services/mapsApi';
import { getFriendlyErrorMessage } from '@/shared/services/errorMessages';
import { useBackToClose } from '@/shared/hooks/useBackToClose';
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner';
import Button from '@/shared/components/ui/Button';
import { getAccessToken } from '@/shared/services/session';
import { joinWithRetry } from '@/shared/services/socketAuth';
import { enqueueOfflineAction } from '@/shared/services/offlineQueue';
import { showBrowserNotification } from '@/shared/services/browserNotify';

const Home = () => {
    const [ pickup, setPickup ] = useState('')
    const [ destination, setDestination ] = useState('')
    const [ panelOpen, setPanelOpen ] = useState(false)
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
    const [ suggestionsSessionToken, setSuggestionsSessionToken ] = useState(null)
    const [ activeField, setActiveField ] = useState(null)
    const [ fare, setFare ] = useState({})
    const [ vehicleType, setVehicleType ] = useState(null)
    // Fase A da experiência de corrida ativa (2026-08-03): a corrida saiu do useState
    // local e passou a viver no RideContext — que reconsulta o backend a cada
    // abertura/reconexão/retorno do background. Refresh na Home não perde mais a
    // corrida; os handlers de socket abaixo continuam atualizando o mesmo estado.
    const { userRide: ride, setUserRide: setRide, syncUserRide, clearUserRide, userParcel } = useContext(RideContext)
    
    const optionalsPanelRef = useRef(null)
    const paymentPanelRef = useRef(null)
    const [ optionalsPanel, setOptionalsPanel ] = useState(false)
    const [ paymentPanel, setPaymentPanel ] = useState(false)
    const [ paymentMethod, setPaymentMethod ] = useState('pix')
    const [ useWalletBalance, setUseWalletBalance ] = useState(false)
    const [ optionals, setOptionals ] = useState([])
    const [ observation, setObservation ] = useState('')
    const [ requestFemaleDriver, setRequestFemaleDriver ] = useState(false)
    const [ promoCode, setPromoCode ] = useState('')

    const { userLocation, locationError } = useContext(LocationContext);

    const [ isSelectingOnMap, setIsSelectingOnMap ] = useState(false)
    const [ mapSelectionCoords, setMapSelectionCoords ] = useState(null)
    // Referência estável — sem isso o LiveTracking (envolvido em React.memo) re-renderiza
    // de qualquer jeito a cada tecla digitada na busca, porque uma arrow function nova
    // seria passada como prop a cada render (item 16 da auditoria de UX).
    const handleMapCenterChange = useCallback((coords) => setMapSelectionCoords(coords), [])
    const [ isSearching, setIsSearching ] = useState(false)
    const [ fareLoading, setFareLoading ] = useState(false)
    const [ showNotificationPrompt, setShowNotificationPrompt ] = useState(false)
    // Auditoria PWA (2026-08-03, C3): antes, permissão "negada" não gerava nenhum
    // aviso — o usuário simplesmente parava de receber notificação de corrida sem
    // nenhuma pista de causa dentro do app.
    const [ notificationsDenied, setNotificationsDenied ] = useState(false)
    const debounceTimer = useRef(null)
    const hasFetchedInitialLocationRef = useRef(false)
    const location = useLocation()

    useEffect(() => {
        // Pós-corrida (2026-08-04): limpa origem/destino/rota residual ao voltar da
        // tela de Riding — sem isto o LiveTracking redesenhava o trajeto fantasma.
        if (location.state?.clearTrip) {
            clearUserRide?.()
            setPickup('')
            setDestination('')
            setVehicleFound(false)
            setWaitingForDriver(false)
            setVehiclePanel(false)
            setConfirmRidePanel(false)
            window.history.replaceState({}, document.title)
            return
        }

        // If coming from Repeat Ride, prefill and find trip
        if (location.state && location.state.pickup && location.state.destination) {
            setPickup(location.state.pickup);
            setDestination(location.state.destination);
            setPanelOpen(true); // Abre o painel automaticamente
            // clear state so it doesn't loop
            window.history.replaceState({}, document.title)
        }
    }, [location.state, clearUserRide])

    useEffect(() => {
        // Se a localização já estiver disponível e ainda não temos o pickup, faz o geocode reverso
        if (userLocation && !pickup && !hasFetchedInitialLocationRef.current) {
            hasFetchedInitialLocationRef.current = true;
            const fetchInitialPickup = async () => {
                const { lat, lng } = userLocation;
                try {
                    const { address } = await reverseGeocode(lat, lng);
                    if (address) {
                        setPickup({
                            address,
                            lat,
                            lng
                        });
                    }
                } catch (err) {
                    console.warn("Reverse geocode on mount failed", err);
                }
            };
            fetchInitialPickup();
        }
        
        // Push Notifications: se a decisão já foi tomada (concedida ou negada), só
        // respeita o que já existe. Se nunca foi perguntado, mostra um cartão explicando
        // o motivo antes do prompt nativo do navegador — pedir sem contexto faz o usuário
        // negar por reflexo e perder notificação de corrida pra sempre (item 18 da
        // auditoria de UX; navegadores não deixam perguntar de novo depois de um "Bloquear").
        const setupFCM = async () => {
            if (!('Notification' in window)) return;
            if (Notification.permission === 'granted') {
                await requestFCMToken();
            } else if (Notification.permission === 'default' && !localStorage.getItem('notificationPromptSeen')) {
                setShowNotificationPrompt(true);
            } else if (Notification.permission === 'denied') {
                setNotificationsDenied(true);
            }
        };
        setupFCM();
    }, []); // Run once on mount

    const handleEnableNotifications = async () => {
        setShowNotificationPrompt(false)
        localStorage.setItem('notificationPromptSeen', '1')
        const permission = await Notification.requestPermission()
        if (permission === 'granted') {
            await requestFCMToken();
        }
    }

    const handleDismissNotifications = () => {
        setShowNotificationPrompt(false)
        localStorage.setItem('notificationPromptSeen', '1')
    }

    const requestLocationPermissions = () => {
        if (locationError) {
            addToast(locationError, 'error');
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
            const result = await reverseGeocode(lat, lng);
            address = result.address || "";
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

    // A9 da auditoria de push (2026-08-02): com o app ABERTO, o Firebase não mostra
    // notificação nativa sozinho (isso só acontece via o Service Worker, com o app em
    // segundo plano/fechado) — sem escutar aqui, uma corrida aceita/iniciada/finalizada
    // que chegasse por push enquanto o passageiro está olhando a tela não aparecia em
    // lugar nenhum (o único aviso em primeiro plano hoje vem do Socket.IO).
    //
    // Precisa ficar DEPOIS de `addToast` acima: o array de dependências é avaliado
    // durante o render, e declarar este efeito antes deixava `addToast` na temporal
    // dead zone — quebrando a Home inteira com "Cannot access 'rt' before
    // initialization" em produção (o build não pega isso, é erro de execução).
    useEffect(() => {
        const unsubscribe = onForegroundMessage((payload) => {
            const title = payload?.notification?.title || payload?.data?.title;
            const body = payload?.notification?.body || payload?.data?.message;
            if (title || body) {
                addToast([title, body].filter(Boolean).join(' — '), 'info');
            }
        });
        return () => unsubscribe();
    }, [addToast]);

    // Fase A da experiência de corrida ativa (2026-08-03): a consulta ao backend saiu
    // daqui e virou responsabilidade do RideContext (que sincroniza em mount, connect,
    // retorno do background e volta da internet). Este efeito só DERIVA os painéis do
    // status da corrida — de onde quer que ela tenha vindo (socket, restore ou ação
    // local), a tela reconstrói o estado visual correto.
    useEffect(() => {
        if (!ride || ride.status === 'finished' || ride.status === 'cancelled') {
            setVehicleFound(false);
            setWaitingForDriver(false);
            // cancelada: limpa pedido local. finished: o listener ride-ended / Riding
            // cuidam do pós-corrida — não redirecionar daqui (evita loop com clearTrip).
            if (ride?.status === 'cancelled') {
                clearUserRide?.()
                setPickup('')
                setDestination('')
            }
            return;
        }
        if (ride.status === 'requested') {
            setVehiclePanel(false);
            setConfirmRidePanel(false);
            setVehicleFound(true); // Restore searching state
            setWaitingForDriver(false);
        } else if (['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'].includes(ride.status)) {
            setVehiclePanel(false);
            setConfirmRidePanel(false);
            setVehicleFound(false);
            setWaitingForDriver(true); // Restore waiting state
        } else {
            // 'started' é tela própria (/riding) — o redirect fica no RideContext, que
            // faz isso uma única vez por corrida; se o passageiro voltou pra Home de
            // propósito, o atalho "Corrida em andamento" (abaixo) leva de volta.
            setVehicleFound(false);
            setWaitingForDriver(false);
        }
    }, [ride?._id, ride?.status, clearUserRide])

    useEffect(() => {
        if (!user || !user._id) return;

        const handleConnect = () => {
            // Auditoria PWA (2026-08-03, C2) + auditoria de regressão de push
            // (2026-08-03): joinWithRetry renova o token e tenta de novo se o atual já
            // estiver vencido — ver docs/plans/2026-08-03-auditoria-regressao-push.md.
            joinWithRetry(socket, { userId: user._id, userType: 'user' })
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
            showBrowserNotification('Motorista Confirmado! 🚗', `Seu OTP é ${ride.otp} — compartilhe com o motorista`)
        }

        const handleRideStarted = (ride) => {
            addToast('Corrida iniciada! Boa viagem 🎉', 'ride', 4000, 'Seu trajeto está sendo acompanhado')
            setWaitingForDriver(false)
            // A navegação pra /riding é feita pelo RideContext ao ver status 'started'
            // — o mesmo caminho usado na restauração pós-refresh, marcado uma única vez
            // por corrida (permite voltar à Home depois sem ser rebatido de volta).
            setRide(ride)
        }

        // P3.1 da auditoria de concorrência (2026-08-02): o backend já emitia este evento
        // a cada "a caminho"/"cheguei" do motorista (ride.controller.js `updateRideStatus`)
        // — só que nenhum frontend escutava. A tela de "aguardando motorista" ficava
        // congelada com os dados do momento do aceite até a corrida começar.
        const handleRideStatusUpdated = (updatedRide) => {
            setRide(updatedRide)
            if (updatedRide.status === 'going_to_pickup') {
                addToast('Motorista a caminho 🚗', 'info', 3000)
            } else if (updatedRide.status === 'arrived') {
                addToast('Motorista chegou!', 'success', 4000, 'Ele está te esperando no local de embarque')
            }
        }

        // Implementação do sistema de cancelamento (2026-08-04): quando o motorista
        // cancela, a corrida NÃO termina — volta pra 'requested' e é redespachada (ver
        // Backend/services/ride.service.js: cancelRideByCaptain). Sem este listener, o
        // passageiro só descobria isso na próxima resincronização do RideContext
        // (reconexão, volta do background) — podia ficar minutos vendo "motorista a
        // caminho" com um motorista que já desistiu. O payload só tem o rideId (mesmo
        // padrão do resto do app); syncUserRide busca o estado real no backend em vez
        // de tentar reconstruir a corrida a partir de um payload parcial.
        const handleRideCancelledByCaptain = () => {
            addToast('Seu motorista não pôde continuar. Buscando outro motorista...', 'info', 5000)
            syncUserRide()
        }

        // Pós-corrida: se o passageiro estiver na Home (atalho durante 'started') quando
        // o motorista finalizar, leva ao resumo em /riding — não deixa trajeto morto aqui.
        const handleRideEnded = (endedRide) => {
            if (!endedRide?._id) return
            setRide(endedRide)
            setVehicleFound(false)
            setWaitingForDriver(false)
            navigate('/riding', { state: { ride: endedRide, openPostRide: true } })
        }

        socket.on('ride-confirmed', handleRideConfirmed)
        socket.on('ride-started', handleRideStarted)
        socket.on('ride-status-updated', handleRideStatusUpdated)
        socket.on('ride-cancelled-by-captain', handleRideCancelledByCaptain)
        socket.on('ride-ended', handleRideEnded)

        return () => {
            socket.off('connect', handleConnect)
            socket.off('ride-confirmed', handleRideConfirmed)
            socket.off('ride-started', handleRideStarted)
            socket.off('ride-status-updated', handleRideStatusUpdated)
            socket.off('ride-cancelled-by-captain', handleRideCancelledByCaptain)
            socket.off('ride-ended', handleRideEnded)
        }
    }, [user, syncUserRide])


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
                    const response = await api.get(`${import.meta.env.VITE_BASE_URL}/maps/get-suggestions`, {
                        params,
                        headers: {
                            Authorization: `Bearer ${getAccessToken('user')}`
                        }
                    })
                    setPickupSuggestions(response.data)
                    // sessionToken só existe quando o provider ativo é "google" (Places New).
                    // Sem efeito nenhum com o provider osm/nominatim (header ausente).
                    setSuggestionsSessionToken(response.headers['x-maps-session-token'] || null)
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
                    const response = await api.get(`${import.meta.env.VITE_BASE_URL}/maps/get-suggestions`, {
                        params,
                        headers: {
                            Authorization: `Bearer ${getAccessToken('user')}`
                        }
                    })
                    setDestinationSuggestions(response.data)
                    setSuggestionsSessionToken(response.headers['x-maps-session-token'] || null)
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

    const handleCurrentLocation = async () => {
        if (!userLocation) {
            addToast(locationError || 'Obtendo geolocalização, aguarde...', 'info');
            return;
        }

        addToast('Definindo sua localização...', 'info');
        const { lat, lng } = userLocation;
        try {
            const { address } = await reverseGeocode(lat, lng);
            if (address) {
                setPickup({ address, lat, lng });
                addToast('Localização atual definida', 'success');
            } else {
                setPickup({ address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng });
                addToast('Usando coordenadas', 'info');
            }
        } catch (err) {
            setPickup({ address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng });
            addToast('Endereço indisponível, usando coords' + err, 'info');
        }
    }

    useGSAP(function () {
        if (panelOpen) {
            gsap.to(panelCloseRef.current, {
                opacity: 1
            })
        } else {
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

    useGSAP(function () {
        if (optionalsPanel) {
            optionalsPanelRef.current.classList.remove('invisible')
            gsap.to(optionalsPanelRef.current, {
                transform: 'translateY(0)',
                duration: 0.3
            })
        } else {
            gsap.to(optionalsPanelRef.current, {
                transform: 'translateY(100%)',
                duration: 0.3,
                onComplete: () => optionalsPanelRef.current?.classList.add('invisible')
            })
        }
    }, [ optionalsPanel ])

    useGSAP(function () {
        if (paymentPanel) {
            paymentPanelRef.current.classList.remove('invisible')
            gsap.to(paymentPanelRef.current, {
                transform: 'translateY(0)',
                duration: 0.3
            })
        } else {
            gsap.to(paymentPanelRef.current, {
                transform: 'translateY(100%)',
                duration: 0.3,
                onComplete: () => paymentPanelRef.current?.classList.add('invisible')
            })
        }
    }, [ paymentPanel ])


    async function findTrip() {
        if (userParcel) {
            addToast('Finalize a encomenda atual antes de pedir uma corrida.', 'info')
            navigate('/encomenda/ativa', { state: { parcel: userParcel } })
            return
        }

        const pickupStr = typeof pickup === 'object' ? `${pickup.address} (${pickup.lat}, ${pickup.lng})` : pickup;
        const destStr = typeof destination === 'object' ? `${destination.address} (${destination.lat}, ${destination.lng})` : destination;

        // O painel de busca fica aberto (com o botão "Buscar Corrida" girando) durante
        // toda a espera — só fecha quando o preço já está pronto para mostrar, ou some
        // sozinho junto do toast de erro. Antes ele fechava na hora, e o usuário ficava
        // olhando pra tela inicial sem nenhum indício de que algo estava carregando.
        setFareLoading(true)
        try {
            const response = await api.get(`${import.meta.env.VITE_BASE_URL}/rides/get-fare`, {
                params: { pickup: pickupStr, destination: destStr },
                headers: {
                    Authorization: `Bearer ${getAccessToken('user')}`
                }
            })

            setFare(response.data)
            setPanelOpen(false)
            setVehiclePanel(true)
        } catch (err) {
            addToast(getFriendlyErrorMessage(err, 'Não foi possível calcular o preço da corrida. Tente novamente.'), 'error')
        } finally {
            setFareLoading(false)
        }
    }

    async function createRide() {
        if (userParcel) {
            addToast('Finalize a encomenda atual antes de pedir uma corrida.', 'info')
            navigate('/encomenda/ativa', { state: { parcel: userParcel } })
            return
        }

        addToast('Buscando motoristas próximos...', 'info', 5000, 'Isso pode levar alguns instantes')

        const pickupStr = typeof pickup === 'object' ? `${pickup.address} (${pickup.lat}, ${pickup.lng})` : pickup;
        const destStr = typeof destination === 'object' ? `${destination.address} (${destination.lat}, ${destination.lng})` : destination;

        devLog(`[AUDIT] Passageiro iniciando request para criar corrida. Pickup: ${pickupStr}, Dest: ${destStr}, Vehicle: ${vehicleType}`);

        try {
            const response = await api.post(`${import.meta.env.VITE_BASE_URL}/rides/create`, {
                pickup: pickupStr,
                destination: destStr,
                vehicleType,
                paymentMethod,
                useWalletBalance,
                optionals,
                observation,
                requestFemaleDriver,
                promoCode: promoCode.trim() || undefined
            }, {
                headers: {
                    Authorization: `Bearer ${getAccessToken('user')}`
                }
            });

            const TRACE_ID = `Ride:${response.data._id}`;
            devLog(`[AUDIT][${TRACE_ID}] Request concluído com sucesso. ID retornado do Backend: ${response.data._id}`);

            // Bloco H (2026-08-02): cupom inválido não impede a corrida (ela já foi
            // criada normalmente, sem desconto) — só avisa o motivo. Cupom aplicado com
            // sucesso mostra quanto foi descontado.
            if (response.data.promoError) {
                addToast(response.data.promoError, 'error');
            } else if (response.data.discountAmount > 0) {
                addToast(`Cupom aplicado! Desconto de R$${response.data.discountAmount.toFixed(2)}.`, 'success');
            }
            setPromoCode('');

            setRide(response.data);
        } catch (err) {
            devError(`[AUDIT] Falha na criação da corrida pelo passageiro:`, err);
            // Antes disso, uma falha aqui deixava o passageiro preso na tela "Buscando
            // motorista" pra sempre — nenhuma corrida existia, e o botão de cancelar
            // não fazia nada (cancelRide não acha corrida nenhuma pra cancelar). Voltar
            // vehicleFound pra false devolve o usuário à tela inicial, com o erro claro.
            setVehicleFound(false)
            addToast(getFriendlyErrorMessage(err, 'Não foi possível solicitar a corrida. Tente novamente.'), 'error')
        }
    }

    async function cancelRide() {
        if (!ride || !ride._id) return;
        
        addToast('Cancelando corrida...', 'info');
        try {
            const response = await api.post(`${import.meta.env.VITE_BASE_URL}/rides/cancel`, {
                rideId: ride._id
            }, {
                headers: {
                    Authorization: `Bearer ${getAccessToken('user')}`
                }
            });
            if (response.data?.cancellationFeeCharged > 0) {
                addToast(
                    `Corrida cancelada. Como o motorista já estava a caminho, uma taxa de R$${response.data.cancellationFeeCharged.toFixed(2)} pode ser cobrada — acerte diretamente com ele.`,
                    'info',
                    8000
                );
            } else {
                addToast('Corrida cancelada.', 'success');
            }
            setWaitingForDriver(false);
            setVehicleFound(false);
            setConfirmRidePanel(false);
            setVehiclePanel(false);
            setRide(null);
            setPickup('');
            setDestination('');
        } catch (err) {
            // Auditoria PWA (2026-08-03, M3): mesma rede de segurança que já existia só
            // pro app do motorista — sem isto, uma queda de rede bem na hora de cancelar
            // simplesmente perdia a ação, exigindo repetir manualmente depois.
            if (!navigator.onLine || err.message === 'Network Error') {
                enqueueOfflineAction({
                    type: 'cancel-ride',
                    rideId: ride._id,
                    payload: { rideId: ride._id }
                }).catch(e => console.error(e));
                addToast('Sem conexão — o cancelamento será confirmado assim que a internet voltar.', 'info', 6000);
                setWaitingForDriver(false);
                setVehicleFound(false);
                setConfirmRidePanel(false);
                setVehiclePanel(false);
                setRide(null);
                setPickup('');
                setDestination('');
            } else {
                addToast(getFriendlyErrorMessage(err, 'Erro ao cancelar corrida.'), 'error');
            }
        }
    }

    // Voltar (gesto do sistema ou seta no topo) recua um passo do fluxo, sem colapsar
    // o painel para "ver o mapa" — o chevron de dismiss foi removido dessas telas.
    // Em "aguardando motorista" não há seta de voltar: cancelar exige confirmação
    // no botão do painel (pode haver taxa).
    const handleRideFlowBack = useCallback(() => {
        if (vehicleFound) {
            if (ride?._id) {
                cancelRide()
            } else {
                setVehicleFound(false)
                setConfirmRidePanel(true)
            }
            return
        }
        if (confirmRidePanel) {
            setConfirmRidePanel(false)
            setVehiclePanel(true)
            return
        }
        if (vehiclePanel) {
            setVehiclePanel(false)
            return
        }
        if (panelOpen) {
            setPanelOpen(false)
        }
    // cancelRide é recriada a cada render; ride já cobre o caso de cancelamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vehicleFound, confirmRidePanel, vehiclePanel, panelOpen, ride])

    useBackToClose(
        panelOpen || vehiclePanel || confirmRidePanel || vehicleFound,
        handleRideFlowBack
    )

    const showRideFlowBack = vehiclePanel || confirmRidePanel || vehicleFound

    return (
        <div className='h-[100dvh] relative overflow-hidden'>
            <ConnectionBanner />

            {showRideFlowBack && (
                <button
                    type="button"
                    onClick={handleRideFlowBack}
                    aria-label="Voltar"
                    className='absolute top-3 left-3 z-40 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-white text-ink-900 shadow-raised border border-line active:scale-95 transition-transform'
                >
                    <i className="ri-arrow-left-line text-2xl" aria-hidden="true"></i>
                </button>
            )}

            {/* Fase A da experiência de corrida ativa (2026-08-03): "link para voltar à
                corrida" que sumia. Se existe corrida 'started' e o passageiro está na
                Home (voltou de propósito ou reabriu o app), este atalho sempre leva de
                volta à tela de acompanhamento. */}
            {ride?.status === 'started' && !showRideFlowBack && (
                <button
                    type="button"
                    onClick={() => navigate('/riding', { state: { ride } })}
                    className='absolute top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-brand-500 text-white font-semibold text-sm px-5 py-3 rounded-full shadow-floating active:scale-95 transition-transform'
                >
                    <i className="ri-navigation-fill" aria-hidden="true"></i>
                    Corrida em andamento — voltar
                </button>
            )}

            <div className='h-[100dvh] w-screen'>
                <LiveTracking 
                    ride={ride} 
                    pickup={pickup} 
                    destination={destination} 
                    vehicleType={vehicleType} 
                    isSelectingOnMap={isSelectingOnMap}
                    onMapCenterChange={handleMapCenterChange}
                    // Fase C (2026-08-03): motoristas disponíveis em tempo real —
                    // visíveis enquanto não há motorista designado (idle ou ainda
                    // procurando). Com corrida aceita, o mapa passa a acompanhar só o
                    // motorista da corrida.
                    showNearbyDrivers={!ride || ride.status === 'requested' || ride.status === 'finished' || ride.status === 'cancelled'}
                    // Pós-corrida: força remoção de polyline/markers da viagem anterior.
                    clearTrip={Boolean(location.state?.clearTrip) || ride?.status === 'finished' || ride?.status === 'cancelled'}
                />
            </div>
            
            <div className={`absolute w-full pointer-events-none z-20 transition-all duration-300 ${panelOpen ? 'top-0 bottom-0 flex flex-col' : 'bottom-0'}`}>
                <div className={`p-6 bg-white relative pointer-events-auto transition-transform duration-300 shadow-2xl ${panelOpen ? 'flex-shrink-0 pb-2' : 'h-auto rounded-t-3xl flex-shrink-0 pb-8'} ${(isSelectingOnMap || vehiclePanel || confirmRidePanel || vehicleFound || waitingForDriver) ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}>
                    
                    {!panelOpen ? (
                        <>
                            <div className="w-10 h-1 bg-line rounded-full mx-auto mb-4"></div>

                            {/* Saudação e localização atual — texto de contexto, deliberadamente
                                mais leve que o campo de busca abaixo (que é a ação primária da
                                tela, não a saudação). Ver §6/item 19 do relatório de UX. */}
                            <div className="mb-4">
                                <p className="text-sm font-medium text-ink-600">
                                    {new Date().getHours() < 12 ? 'Bom dia' : new Date().getHours() < 18 ? 'Boa tarde' : 'Boa noite'}, {user?.fullname?.firstname || ''}
                                </p>
                                <p className="text-xs text-ink-400 truncate flex items-center gap-1 mt-0.5">
                                    <i className="ri-map-pin-2-fill text-brand-500" aria-hidden="true"></i>
                                    {typeof pickup === 'object' && pickup?.address ? pickup.address : 'Obtendo sua localização...'}
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={() => {
                                    setPanelOpen(true)
                                    setActiveField('destination')
                                    requestLocationPermissions()
                                }}
                                className="w-full bg-surface border border-line px-5 py-4 rounded-panel shadow-raised flex items-center gap-3 active:scale-[0.98] transition-transform"
                            >
                                <i className="ri-search-line text-xl text-brand-500" aria-hidden="true"></i>
                                <span className="text-ink-900 font-semibold text-base">Para onde vamos?</span>
                            </button>

                            <div className="mt-3 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (ride) {
                                            addToast('Finalize a corrida atual antes de pedir uma encomenda.', 'info')
                                            return
                                        }
                                        if (userParcel) {
                                            navigate('/encomenda/ativa', { state: { parcel: userParcel } })
                                            return
                                        }
                                        navigate('/encomenda')
                                    }}
                                    className="flex-1 min-w-0 bg-surface-alt border border-line px-3 py-3.5 rounded-panel flex items-center gap-2 active:scale-[0.98] transition-transform"
                                    aria-label={userParcel ? 'Encomenda em andamento' : 'Fazer uma encomenda'}
                                >
                                    <i className="ri-box-3-line text-xl text-brand-500 shrink-0" aria-hidden="true"></i>
                                    <span className="flex-1 min-w-0 text-left text-ink-900 font-semibold text-sm leading-tight truncate">
                                        {userParcel ? 'Em andamento' : 'Encomenda'}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigate('/agendar')}
                                    className="flex-1 min-w-0 bg-surface-alt border border-line px-3 py-3.5 rounded-panel flex items-center gap-2 active:scale-[0.98] transition-transform"
                                    aria-label="Agendar corrida ou encomenda"
                                >
                                    <i className="ri-calendar-event-line text-xl text-brand-500 shrink-0" aria-hidden="true" />
                                    <span className="flex-1 min-w-0 text-left text-ink-900 font-semibold text-sm leading-tight truncate">
                                        Agendar
                                    </span>
                                </button>
                            </div>

                            {showNotificationPrompt && (
                                <div className="mt-4 bg-surface-alt border border-line rounded-panel p-4 flex gap-3">
                                    <i className="ri-notification-3-fill text-brand-500 text-xl flex-shrink-0 mt-0.5" aria-hidden="true"></i>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-ink-900">Ativar notificações?</p>
                                        <p className="text-xs text-ink-400 mt-0.5">Avisamos quando seu motorista aceitar, chegar e iniciar a corrida.</p>
                                        <div className="flex gap-2 mt-3">
                                            <button
                                                type="button"
                                                onClick={handleEnableNotifications}
                                                className="min-h-[36px] px-4 rounded-full bg-brand-500 active:bg-brand-600 text-white text-sm font-semibold"
                                            >
                                                Ativar
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleDismissNotifications}
                                                className="min-h-[36px] px-4 rounded-full text-ink-600 text-sm font-medium"
                                            >
                                                Agora não
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {notificationsDenied && (
                                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-panel p-4 flex gap-3">
                                    <i className="ri-notification-off-fill text-amber-600 text-xl flex-shrink-0 mt-0.5" aria-hidden="true"></i>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-ink-900">Notificações bloqueadas</p>
                                        <p className="text-xs text-ink-400 mt-0.5">Você não vai receber avisos de motorista aceitando, chegando ou iniciando a corrida. Ative nas configurações de notificação do navegador para este site.</p>
                                        <button
                                            type="button"
                                            onClick={() => setNotificationsDenied(false)}
                                            className="min-h-[36px] px-4 mt-3 rounded-full text-ink-600 text-sm font-medium"
                                        >
                                            Entendi
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                ref={panelCloseRef}
                                onClick={() => setPanelOpen(false)}
                                aria-label="Fechar busca"
                                className='absolute right-4 top-4 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 active:scale-95 transition-transform'
                            >
                                <i className="ri-arrow-down-wide-line text-2xl" aria-hidden="true"></i>
                            </button>
                            <h4 className='text-xl font-semibold text-ink-900'>Escolha um destino</h4>
                            <form className='relative mt-4' onSubmit={submitHandler}>
                                {/* Timeline / Dots */}
                                <div className="absolute left-2 top-[22px] bottom-[26px] flex flex-col items-center">
                                    <div className="w-2.5 h-2.5 rounded-full border-2 border-brand-500 bg-white z-10"></div>
                                    <div className="w-0.5 bg-line flex-1 my-1"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-brand-500 z-10"></div>
                                </div>

                                <div className="pl-8">
                                    {/* Pickup Field */}
                                    <div className="border-b border-line pb-2 mb-2 relative">
                                        <label className="text-xs text-brand-700 font-medium ml-1">Partida</label>
                                        <input
                                            onClick={() => {
                                                setActiveField('pickup')
                                                requestLocationPermissions()
                                            }}
                                            value={typeof pickup === 'object' ? pickup.address : pickup}
                                            onChange={handlePickupChange}
                                            className='w-full pl-1 pr-11 py-1 text-[16px] text-ink-900 font-medium outline-none bg-transparent placeholder-ink-400'
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
                                            aria-label="Usar minha localização atual"
                                            className='absolute right-0 top-1/2 translate-y-[-20%] p-3 -m-1 text-ink-400 active:text-brand-500 flex items-center justify-center z-20'
                                        >
                                            <i className="ri-gps-line text-xl" aria-hidden="true"></i>
                                        </button>
                                    </div>

                                    {/* Destination Field */}
                                    <div className="relative pt-1">
                                        <label className="text-xs text-brand-700 font-medium ml-1">Destino</label>
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
                            <Button onClick={findTrip} loading={fareLoading} className='mt-3'>
                                Buscar Corrida
                            </Button>
                        </>
                    )}
                </div>
                <div ref={panelRef} className={`bg-white pointer-events-auto transition-all duration-300 ${panelOpen ? 'flex-1 overflow-y-auto overscroll-y-contain p-6' : 'h-0 overflow-hidden'} ${isSelectingOnMap ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}>
                    <LocationSearchPanel
                        suggestions={activeField === 'pickup' ? pickupSuggestions : destinationSuggestions}
                        setPanelOpen={setPanelOpen}
                        setVehiclePanel={setVehiclePanel}
                        setPickup={setPickup}
                        setDestination={setDestination}
                        activeField={activeField}
                        setIsSelectingOnMap={setIsSelectingOnMap}
                        isSearching={isSearching}
                        sessionToken={suggestionsSessionToken}
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
            {/* Painéis do fluxo de corrida: altura inicial ~35–40% (mapa dominante).
                Conteúdo longo continua rolável; max 80% mantém o mapa visível. */}
            <div ref={vehiclePanelRef} className='fixed w-full z-30 bottom-0 translate-y-full invisible bg-white px-3 pt-3 pb-[env(safe-area-inset-bottom,12px)] rounded-t-3xl shadow-2xl max-h-[80dvh] overflow-y-auto overscroll-y-contain'>
                <VehiclePanel
                    selectVehicle={setVehicleType}
                    fare={fare} setConfirmRidePanel={setConfirmRidePanel} setVehiclePanel={setVehiclePanel} />
            </div>
            <div ref={confirmRidePanelRef} className='fixed w-full z-30 bottom-0 translate-y-full invisible bg-white px-3 pt-3 pb-[env(safe-area-inset-bottom,12px)] rounded-t-3xl shadow-2xl max-h-[80dvh] overflow-y-auto overscroll-y-contain'>
                <ConfirmRide
                    createRide={createRide}
                    pickup={pickup}
                    destination={destination}
                    fare={fare}
                    vehicleType={vehicleType}
                    setConfirmRidePanel={setConfirmRidePanel}
                    setVehicleFound={setVehicleFound}
                    setOptionalsPanel={setOptionalsPanel}
                    setPaymentPanel={setPaymentPanel}
                    paymentMethod={paymentMethod}
                    promoCode={promoCode}
                    setPromoCode={setPromoCode}
                />
            </div>
            <div ref={optionalsPanelRef} className='fixed w-full z-40 bottom-0 translate-y-full invisible bg-white px-3 pt-8 pb-[env(safe-area-inset-bottom,12px)] rounded-t-3xl shadow-2xl max-h-[80dvh] overflow-y-auto overscroll-y-contain'>
                <OptionalsPanel
                    setOptionalsPanel={setOptionalsPanel}
                    setOptionals={setOptionals}
                    setObservation={setObservation}
                    setRequestFemaleDriver={setRequestFemaleDriver}
                />
            </div>
            <div ref={paymentPanelRef} className='fixed w-full z-40 bottom-0 translate-y-full invisible bg-white px-3 pt-8 pb-[env(safe-area-inset-bottom,12px)] rounded-t-3xl shadow-2xl max-h-[80dvh] overflow-y-auto overscroll-y-contain'>
                <PaymentOptionsPanel
                    setPaymentPanel={setPaymentPanel}
                    paymentMethod={paymentMethod}
                    setPaymentMethod={setPaymentMethod}
                    useWalletBalance={useWalletBalance}
                    setUseWalletBalance={setUseWalletBalance}
                    walletBalance={user?.walletBalance}
                />
            </div>
            <div ref={vehicleFoundRef} className='fixed w-full z-30 bottom-0 translate-y-full invisible bg-white px-3 pt-3 pb-[env(safe-area-inset-bottom,12px)] rounded-t-3xl shadow-2xl'>
                <LookingForDriver
                    createRide={createRide}
                    pickup={pickup}
                    destination={destination}
                    fare={fare}
                    vehicleType={vehicleType}
                    paymentMethod={paymentMethod}
                    cancelRide={cancelRide} />
            </div>
            {/* Painel sempre aberto: altura pelo conteúdo — sem scroll nem expansão. */}
            <div ref={waitingForDriverRef} className='fixed w-full z-30 bottom-0 translate-y-full invisible bg-white px-3 pt-2 pb-[env(safe-area-inset-bottom,12px)] rounded-t-3xl shadow-2xl'>
                <WaitingForDriver
                    ride={ride}
                    cancelRide={cancelRide}
                    setVehicleFound={setVehicleFound}
                    setWaitingForDriver={setWaitingForDriver}
                    waitingForDriver={waitingForDriver} />
            </div>

            {/* Bottom Navigation */}
            {!(panelOpen || vehiclePanel || confirmRidePanel || optionalsPanel || paymentPanel || vehicleFound || waitingForDriver || isSelectingOnMap) && (
                <Header />
            )}
        </div>
    )
}

export default Home