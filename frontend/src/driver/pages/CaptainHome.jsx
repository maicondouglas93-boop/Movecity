import { useRef, useState, useEffect, useContext, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import CaptainDetails from '@/driver/components/CaptainDetails'
import RidePopUp from '@/driver/components/RidePopUp'
import ConfirmRidePopUp from '@/driver/components/ConfirmRidePopUp'
import ParcelPopUp from '@/driver/components/ParcelPopUp'
import { acceptParcel, declineParcel, getPendingParcels } from '@/shared/services/parcelApi'
import ApprovalGate from '@/driver/components/ApprovalGate'
import DriverAccountShell from '@/driver/components/DriverAccountShell'
import DriverOperationalDialog from '@/driver/components/DriverOperationalDialog'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { RideContext } from '@/shared/contexts/RideContext'
import api from '@/shared/services/axios'
import LiveTracking from '@/shared/components/LiveTracking'
import { useToast } from '@/shared/contexts/ToastContext'
import { onForegroundMessage } from '@/shared/services/fcm'
import { bindPushNavigation } from '@/shared/platform/notification.service'
import { isNativePlatform } from '@/shared/platform/platform'
import { useWakeLock } from '@/shared/hooks/useWakeLock'
import { flushQueuedLocations, replayOfflineActions } from '@/shared/services/offlineQueue'
import { withHardTimeout } from '@/shared/utils/hardTimeout'
import { joinWithRetry } from '@/shared/services/socketAuth'
import { showBrowserNotification } from '@/shared/services/browserNotify'
import { presentNativeRideOffer } from '@/shared/platform/nativeRideOffer.service'
import { vehicleLabels } from '@/shared/assets/vehicleAssets'
import { useOfferQueue } from '@/shared/services/rideOffer/useOfferQueue'
import { useOfferAlert } from '@/shared/services/rideOffer/useOfferAlert'
import { formatBRL } from '@/shared/utils/currency'
import { acceptDriverRide } from '@/driver/services/acceptDriverRide'
import { isRideAssignedToCaptain, PICKUP_STATES } from '@/shared/utils/driverRideState'
import { isOfferExpired } from '@/shared/services/rideOffer/offerExpiry'

const haversineKm = (a, b) => {
    if (!a || !b || a.lat == null || b.lat == null) return null
    const toRad = (v) => (v * Math.PI) / 180
    const R = 6371
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const sinA = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(sinA), Math.sqrt(1 - sinA))
}

const rideTypeAnnouncement = (vehicleType) => {
    if (['moto', 'motorcycle'].includes(vehicleType)) return { heading: '🏍️ CORRIDA DE MOTO' }
    if (vehicleType === 'car') return { heading: '🚗 CORRIDA DE CARRO' }
    return { heading: 'Nova corrida' }
}

const CaptainHome = () => {

    const [ ridePopupPanel, setRidePopupPanel ] = useState(false)
    const [ confirmRidePopupPanel, setConfirmRidePopupPanel ] = useState(false)
    const [ searchParams, setSearchParams ] = useSearchParams()

    const [ ride, setRide ] = useState(null)
    const [ acceptingRideId, setAcceptingRideId ] = useState(null)
    const [ uncertainAcceptance, setUncertainAcceptance ] = useState(null)
    const acceptRequestRef = useRef(null)
    const uncertainAcceptanceRef = useRef(null)
    const captainIdRef = useRef(null)
    const mountedRef = useRef(true)
    const offerEpochRef = useRef(0)
    const pendingRideSyncRef = useRef(0)
    const pendingParcelSyncRef = useRef(0)
    const restoredRideIdRef = useRef(null)
    useEffect(() => {
        mountedRef.current = true
        return () => { mountedRef.current = false }
    }, [])
    // Fase B da experiência de corrida ativa (2026-08-03): corridas 'requested'
    // compatíveis vindas do pull GET /rides/pending — a fonte persistente das ofertas.
    // O evento 'new-ride' (socket) só adiciona/atualiza; quem garante que nada se perde
    // é a sincronização no mount, no reconnect, no retorno do background e no 'online'.
    const [ pendingRides, setPendingRides ] = useState([])
    const [ parcelOffer, setParcelOffer ] = useState(null)
    const [ parcelPopupOpen, setParcelPopupOpen ] = useState(false)
    const [ dismissedOfferKey, setDismissedOfferKey ] = useState(null)
    const [ acceptingParcel, setAcceptingParcel ] = useState(null)
    const [ pickupBusy, setPickupBusy ] = useState(false)
    const [ availabilityBusy, setAvailabilityBusy ] = useState(false)
    const availabilityBusyRef = useRef(false)
    const onAvailabilityBusyChange = useCallback(value => {
        availabilityBusyRef.current = value
        setAvailabilityBusy(value)
    }, [])
    const parcelAcceptRef = useRef(null)
    const [ scheduledUpcoming, setScheduledUpcoming ] = useState([])

    const navigate = useNavigate()
    const { socket } = useContext(SocketContext)
    const { captain, setCaptain } = useContext(CaptainDataContext)
    captainIdRef.current = captain?._id
    const { userLocation } = useContext(LocationContext)
    const { captainRide, setCaptainRide, syncCaptainRide, setCaptainParcel, captainParcel } = useContext(RideContext)
    const { addToast } = useToast()
    const [ refreshingApproval, setRefreshingApproval ] = useState(false)
    const approvalRequestRef = useRef(null)
    useEffect(() => {
        approvalRequestRef.current = null
        setRefreshingApproval(false)
    }, [captain?._id])
    const availabilityRef = useRef(null)
    availabilityRef.current = captain
    const canReceiveOffers = () => {
        const current = availabilityRef.current
        return Boolean(current?._id) && current.approvalStatus === 'aprovado'
            && !current.isBlocked && current.isOnline !== false && current.canReceiveRides !== false
            && !captainRideRef.current && !captainParcelRef.current
    }

    const clearUncertainAcceptance = () => {
        uncertainAcceptanceRef.current = null
        setUncertainAcceptance(null)
    }
    const invalidateAcceptance = (rideId) => {
        if (acceptRequestRef.current?.rideId === rideId) acceptRequestRef.current.invalidated = true
        if (uncertainAcceptanceRef.current?._id === rideId) clearUncertainAcceptance()
    }
    useEffect(() => {
        if (acceptRequestRef.current) acceptRequestRef.current.invalidated = true
        clearUncertainAcceptance()
        offerEpochRef.current += 1
        offerQueue.clear()
        setPendingRides([])
        setRide(null)
        setParcelOffer(null)
        setRidePopupPanel(false)
        setParcelPopupOpen(false)
        setConfirmRidePopupPanel(false)
        setDismissedOfferKey(null)
        if (parcelAcceptRef.current) parcelAcceptRef.current.invalidated = true
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [captain?._id])

    const removePendingRide = (rideId) => {
        offerEpochRef.current += 1
        setPendingRides(prev => prev.filter(r => r._id !== rideId))
    }

    const syncPendingRides = async () => {
        const ownerId = captainIdRef.current
        if (!canReceiveOffers()) return
        const epoch = offerEpochRef.current
        const sequence = ++pendingRideSyncRef.current
        try {
            const response = await withHardTimeout(api.get('/rides/pending'))
            if (!mountedRef.current || captainIdRef.current !== ownerId || !canReceiveOffers()
                || epoch !== offerEpochRef.current || sequence !== pendingRideSyncRef.current) return
            const list = Array.isArray(response.data) ? response.data : []
            setPendingRides(list)
            list.forEach(item => offerQueue.enqueue('ride', item))
        } catch (err) {
            // Sem rede/token vencido: mantém a lista atual; a próxima sincronização
            // (reconnect/visibilidade/online) corrige.
            console.error('Falha ao sincronizar corridas pendentes:', err)
        }
    }

    // Fase A da experiência de corrida ativa (2026-08-03): restauração da corrida
    // aceita (pré-início). Antes, um refresh com corrida em 'accepted'/'going_to_pickup'/
    // 'arrived' deixava a Home vazia — os botões "A caminho"/"Cheguei"/"Iniciar" sumiam, mas o
    // motorista continuava vinculado à corrida no banco (índice único), travado sem UI.
    // O RideContext consulta /rides/captain-current a cada abertura/reconexão/retorno do
    // background; aqui só reabrimos o painel certo com o status real do backend.
    // Corrida 'started' não passa por aqui: o RideContext redireciona pra /captain-riding.
    useEffect(() => {
        const previousId = restoredRideIdRef.current
        restoredRideIdRef.current = captainRide?._id || null
        if (!captainRide || !PICKUP_STATES.includes(captainRide.status)) {
            if (previousId) {
                setRide(current => current?._id === previousId ? null : current)
                setConfirmRidePopupPanel(false)
            }
            if (!captainRide) return
        }
        if (!isRideAssignedToCaptain(captainRide, captain?._id)) return
        uncertainAcceptanceRef.current = null
        setUncertainAcceptance(null)
        // Presencial: a confirmação tem tela própria (não o popup de corrida despachada).
        if (captainRide.source === 'driver_initiated') {
            if (captainRide.status === 'started') return
            if ([ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger' ].includes(captainRide.status)) {
                navigate('/captain-presential')
            }
            return
        }
        if ([ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger' ].includes(captainRide.status)) {
            setRide(captainRide)
            setRidePopupPanel(false)
            setConfirmRidePopupPanel(true)
        }
    }, [captainRide?._id, captainRide?.status, captainRide?.source, captain?._id, navigate])

    // Auditoria de UX do motorista (2026-08-02, §2.7): busca o perfil de novo sob
    // demanda (botão "Verificar novamente" do ApprovalGate) — o contexto só é
    // atualizado no login/refresh de página, então um motorista aprovado enquanto o
    // app estava aberto continuaria vendo a tela de bloqueio até fechar e reabrir.
    const refreshApprovalStatus = async ({ silent = false } = {}) => {
        const snapshot = availabilityRef.current
        if (!snapshot?._id || approvalRequestRef.current) return
        const request = {}
        approvalRequestRef.current = request
        setRefreshingApproval(true)
        try {
            const response = await withHardTimeout(api.get('/captains/profile'))
            const next = response.data.captain
            // Uma leitura iniciada antes de um envio não pode apagar o documento confirmado.
            if (!mountedRef.current || approvalRequestRef.current !== request || availabilityRef.current !== snapshot || captainIdRef.current !== snapshot._id) return
            if (next?._id !== snapshot._id) throw new Error('Resposta de perfil não corresponde à conta atual')
            setCaptain(previous => previous === snapshot ? next : previous)
            if (!silent) {
                if (next?.approvalStatus === 'aprovado' && !next?.isBlocked) {
                    addToast('Cadastro aprovado! Você já pode ficar online.', 'success')
                } else {
                    addToast(`Status atual: ${next?.approvalStatus || 'desconhecido'}`, 'info')
                }
            }
        } catch (err) {
            if (!mountedRef.current || captainIdRef.current !== snapshot._id) return
            if (!silent) {
                addToast(err.friendlyMessage || 'Não foi possível atualizar o status. Verifique a conexão.', 'error')
            }
        } finally {
            if (approvalRequestRef.current === request) {
                approvalRequestRef.current = null
                if (mountedRef.current && captainIdRef.current === snapshot._id) setRefreshingApproval(false)
            }
        }
    }

    // Enquanto o gate estiver aberto, reconsulta o banco periodicamente (aprovação no admin).
    useEffect(() => {
        if (!captain || captain.isBlocked || captain.approvalStatus === 'aprovado') return undefined
        const id = window.setInterval(() => {
            refreshApprovalStatus({ silent: true })
        }, 15000)
        return () => window.clearInterval(id)
    }, [captain?._id, captain?.approvalStatus, captain?.isBlocked])

    useEffect(() => {
        let cleanup
        ;(async () => {
            cleanup = await bindPushNavigation(({ data, deepLink, fromTap }) => {
                // Tap da notificação: sempre navega (rideOffer / parcelOffer / riding).
                if (fromTap && deepLink) {
                    try {
                        const url = new URL(deepLink, window.location.origin)
                        navigate(`${url.pathname}${url.search}`)
                    } catch {
                        navigate('/captain-home')
                    }
                    return
                }
                // Foreground push de oferta: socket/popup já cobrem — sem toast duplicado.
                if (data?.type === 'NEW_RIDE' || data?.type === 'NEW_PARCEL') return
                const title = data?.title
                const body = data?.message || data?.body
                if (title || body) {
                    addToast([title, body].filter(Boolean).join(' — '), 'info')
                }
            })
        })()

        // Web foreground FCM (além do bind nativo)
        const unsubWeb = isNativePlatform()
            ? () => {}
            : onForegroundMessage((payload) => {
                if (payload?.data?.type === 'NEW_RIDE' || payload?.data?.type === 'NEW_PARCEL') return
                const title = payload?.notification?.title || payload?.data?.title
                const body = payload?.notification?.body || payload?.data?.message
                if (title || body) {
                    addToast([title, body].filter(Boolean).join(' — '), 'info')
                }
            })

        return () => {
            cleanup?.()
            unsubWeb?.()
        }
    }, [addToast, navigate])

    const { requestLock } = useWakeLock();
    useEffect(() => {
        requestLock();
    }, [requestLock]);

    // FGS + emit GPS: CaptainLocationBridge (DriverAppProviders) — não amarrar ao GO.

    // Ref para acessar o ride atual dentro de handlers sem precisar re-subscrever
    const rideRef = useRef(ride)
    useEffect(() => { rideRef.current = ride }, [ride])

    // Mesmo motivo: handleRideTaken precisa saber se a corrida do evento já é DESTE
    // motorista (aceite confirmado pelo backend) sem re-subscrever os listeners.
    const captainRideRef = useRef(captainRide)
    useEffect(() => { captainRideRef.current = captainRide }, [captainRide])
    const captainParcelRef = useRef(captainParcel)
    useEffect(() => { captainParcelRef.current = captainParcel }, [captainParcel])
    const parcelOfferRef = useRef(parcelOffer)
    useEffect(() => { parcelOfferRef.current = parcelOffer }, [parcelOffer])

    // Auditoria PWA (2026-08-07, P3/P4/P8): fila única de ofertas (corrida +
    // encomenda), uma em destaque por vez, dedup por offerId — ver
    // docs/plans/2026-08-07-pwa-oferta-corrida-encomenda.md. Substitui a lógica
    // antes espalhada em handleNewRide/handleNewParcel que ora descartava
    // silenciosamente uma oferta cruzada, ora deixava a mais nova sobrescrever
    // a mais antiga sem fila.
    const offerQueue = useOfferQueue()
    const assignedRide = isRideAssignedToCaptain(captainRide, captain?._id) ? captainRide
        : isRideAssignedToCaptain(ride, captain?._id) ? ride : null
    const offerEntry = !availabilityBusy && !assignedRide && !captainParcel && !acceptingRideId && !uncertainAcceptance && !acceptingParcel
        && captain?.approvalStatus === 'aprovado' && !captain.isBlocked && captain.isOnline !== false
        && captain.canReceiveRides !== false && offerQueue.active && !isOfferExpired(offerQueue.active.data)
        ? offerQueue.active : null
    const offerKey = offerEntry ? `${offerEntry.kind}:${offerEntry.offerId}:${offerEntry.data.offerExpiresAt || ''}` : null
    const visibleOffer = offerKey && dismissedOfferKey !== offerKey ? offerEntry : null
    const pickupOpen = Boolean(confirmRidePopupPanel && assignedRide && PICKUP_STATES.includes(assignedRide.status))
    const modalKind = pickupOpen ? 'pickup' : acceptingParcel ? 'parcel' : acceptingRideId && ridePopupPanel ? 'ride' : visibleOffer?.kind
    const modalOpen = Boolean(modalKind)
    // Som em loop + vibração reforçada enquanto a oferta em destaque não muda;
    // para sozinho ao aceitar/recusar/expirar (offerId muda ou some).
    useOfferAlert(visibleOffer?.offerId)

    useEffect(() => {
        if (!captainRide && !captainParcel && captain?.isOnline !== false && captain?.canReceiveRides !== false && !captain?.isBlocked && captain?.approvalStatus === 'aprovado') return
        offerEpochRef.current += 1
        offerQueue.clear()
        setPendingRides([])
        setRidePopupPanel(false)
        setParcelPopupOpen(false)
        // Só reage à identidade/indisponibilidade, não a cada atualização do GPS.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [captainRide?._id, captainParcel?._id, captain?.isOnline, captain?.canReceiveRides, captain?.isBlocked, captain?.approvalStatus, offerQueue.clear])

    // Espelha a oferta em destaque da fila nos painéis existentes (RidePopUp /
    // ParcelPopUp) — nunca zera `ride`/`parcelOffer` aqui: eles continuam vivos
    // por trás de um painel fechado (ex.: `ride` também representa a corrida já
    // aceita exibida no ConfirmRidePopUp, que não é gerido pela fila).
    useEffect(() => {
        if (acceptingRideId || uncertainAcceptance || acceptingParcel) return
        if (assignedRide || captainParcel) return
        const active = offerQueue.active
        if (!active) {
            setRidePopupPanel(false)
            setParcelPopupOpen(false)
            return
        }
        if (active.kind === 'ride') {
            setRide(active.data)
            setRidePopupPanel(true)
            setParcelPopupOpen(false)
        } else {
            setParcelOffer(active.data)
            setParcelPopupOpen(true)
            setRidePopupPanel(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [offerQueue.active, acceptingRideId, uncertainAcceptance, acceptingParcel, assignedRide?._id, assignedRide?.status, captainParcel?._id])

    const syncScheduledUpcoming = useCallback(async () => {
        try {
            const { data } = await withHardTimeout(api.get('/captains/scheduled-upcoming'))
            setScheduledUpcoming(data.upcoming || [])
        } catch {
            /* ignore */
        }
    }, [])

    const syncPendingParcels = useCallback(async () => {
        if (!canReceiveOffers()) return
        const ownerId = captainIdRef.current
        const epoch = offerEpochRef.current
        const sequence = ++pendingParcelSyncRef.current
        try {
            const parcels = await withHardTimeout(getPendingParcels())
            if (!mountedRef.current || captainIdRef.current !== ownerId || !canReceiveOffers()
                || epoch !== offerEpochRef.current || sequence !== pendingParcelSyncRef.current) return
            if (Array.isArray(parcels)) {
                // Antes só parcels[0] entrava na tela — as demais ficavam invisíveis
                // até o próximo sync. A fila aceita todas (dedup por offerId cuida de
                // não duplicar a cada polling).
                parcels.forEach((parcel) => offerQueue.enqueue('parcel', parcel))
            }
        } catch {
            /* ignore */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // --- Efeito 1: conexão e listeners do socket (só depende do captain) ---
    useEffect(() => {
        if (!captain || !captain._id) return;

        const handleConnect = () => {
            // Auditoria PWA (2026-08-03, C2): o backend agora exige o JWT pra validar
            // quem está de fato entrando — sem isto, o join é rejeitado. Auditoria de
            // regressão de push (2026-08-03): joinWithRetry renova o token e tenta de
            // novo se o token atual já estiver vencido — sem isso, um motorista com o
            // app aberto podia cair fora do despacho silenciosamente numa reconexão
            // (ver docs/plans/2026-08-03-auditoria-regressao-push.md).
            joinWithRetry(socket, { userId: captain._id, userType: 'captain' }, () => {
                flushQueuedLocations(socket)
                    .catch((e) => console.error(e))
                    .finally(() => {
                        replayOfflineActions({ socket }).catch((e) => console.error(e))
                    })
                // Fase B: reconexão pode ter perdido eventos 'new-ride'/'new-parcel'.
                syncPendingRides()
                syncPendingParcels()
                syncScheduledUpcoming()
            })
        }

        if (socket.connected) {
            handleConnect()
        }
        socket.on('connect', handleConnect)

        const handleNewRide = (data) => {
            if (!data?._id || !canReceiveOffers() || isOfferExpired(data)) return
            const TRACE_ID = `Ride:${data._id}`;
            console.log(`[AUDIT][${TRACE_ID}] Oferta recebida via socket.`);

            // Fase B: a oferta também entra na lista persistente — se o motorista
            // ignorar o popup, ela continua acessível no card "Corrida disponível".
            setPendingRides(prev => {
                const rest = prev.filter(r => r._id !== data._id)
                return [ data, ...rest ]
            })

            // Auditoria PWA (2026-08-07, P3): antes, chegar aqui com uma encomenda
            // pendente na tela descartava a corrida sem sequer guardar no pendingRides.
            // A fila decide sozinha quem fica em destaque — nunca perde a oferta.
            if (!offerQueue.enqueue('ride', data)) return
            console.log(`[AUDIT][${TRACE_ID}] Oferta enfileirada.`);

            const rideType = rideTypeAnnouncement(data.vehicleType)
            addToast(`${rideType.heading} · ${data.user?.fullname?.firstname || 'Passageiro'}`, 'ride')

            // APK: tela cheia nativa na hora (FSI vira só heads-up com tela desbloqueada).
            presentNativeRideOffer({
                type: 'NEW_RIDE',
                rideId: data._id,
                title: rideType.heading,
                message: `${data.pickup?.split(',')[0] || 'Origem'} → ${data.destination?.split(',')[0] || 'Destino'} • ${formatBRL(data.fare)}`,
                fare: data.fare,
                pickup: data.pickup,
                destination: data.destination,
                vehicleType: data.vehicleType,
                deepLink: `/captain-home?rideOffer=${data._id}`,
            })

            // P7: notificação do SO só quando a aba não está em foreground visível —
            // com o modal/popup já na tela, ela era só um eco redundante do mesmo aviso.
            if (!isNativePlatform() && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
                showBrowserNotification(
                    rideType.heading,
                    `${data.pickup?.split(',')[0]} → ${data.destination?.split(',')[0]} • ${formatBRL(data.fare)}`,
                    { tag: `ride-${data._id}` }
                )
                console.log(`[AUDIT][${TRACE_ID}] Web Push Nativo (Browser) exibido.`);
            }
        }

        const handleRideCancelled = (data) => {
            // Fase B: a corrida deixa de estar disponível — sai do card persistente.
            const cancelledId = data?.rideId
            invalidateAcceptance(cancelledId)
            removePendingRide(cancelledId)
            offerQueue.remove(cancelledId)
            const matchesActive =
                (rideRef.current && String(rideRef.current._id) === String(cancelledId)) ||
                (captainRideRef.current && String(captainRideRef.current._id) === String(cancelledId))
            if (matchesActive) {
                // Fase A da experiência de corrida ativa (2026-08-03): também fecha o
                // ConfirmRidePopUp e limpa o RideContext — antes só o popup de oferta
                // fechava, e um cancelamento após o aceite deixava a tela de "A caminho/
                // Cheguei/Iniciar" pendurada com uma corrida que já não existia.
                setRidePopupPanel(false)
                setConfirmRidePopupPanel(false)
                setRide(null)
                setCaptainRide(null)
                addToast(
                    data?.cancelledBy === 'admin'
                        ? 'Corrida cancelada pelo administrador.'
                        : 'A corrida foi cancelada pelo passageiro.',
                    'info',
                )
            }
        }

        // P3.1 da auditoria de concorrência (2026-08-02): emitido desde sempre pelo
        // backend quando outro motorista aceita a corrida primeiro (ride.controller.js),
        // mas nenhum frontend escutava — o motorista que perdeu a corrida ficava com o
        // popup aberto até tocar em algo, sem saber que ela já tinha sido pega.
        const handleRideTaken = (data) => {
            // Fase B: a corrida deixou de estar disponível para todo mundo — sai do
            // card persistente (para o vencedor ela vira a corrida ativa, não um card).
            removePendingRide(data.rideId)
            offerQueue.remove(data.rideId)

            // Correção crítica do aceite (2026-08-03): a sala ride_<id> inclui TODOS os
            // candidatos do despacho — inclusive o vencedor, que recebia o próprio
            // evento e via "aceita por outro motorista" com a corrida já sendo dele.
            // Quem venceu vem do BACKEND no payload (captainId); o fallback pelo
            // RideContext cobre a janela em que o aceite já respondeu 200 mas o evento
            // chegou por uma reconexão sem captainId.
            const wonByThisCaptain =
                (data.captainId && data.captainId === captain._id) ||
                (captainRideRef.current && captainRideRef.current._id === data.rideId)
            if (wonByThisCaptain) return
            invalidateAcceptance(data.rideId)

            if (rideRef.current && rideRef.current._id === data.rideId) {
                // Evento definitivo invalida também uma resposta HTTP atrasada.
                setRidePopupPanel(false)
                setConfirmRidePopupPanel(false)
                setRide(null)
                addToast('Essa corrida já foi aceita por outro motorista.', 'info')
            }
        }

        const handleNewParcel = (data) => {
            const TRACE_ID = `Parcel:${data._id}`
            // Defesa extra: backend já exclui do despacho quem tem trabalho ATIVO
            // (excludeActiveRide/excludeActiveParcel) — isto só cobre uma janela rara
            // (aceite em outro dispositivo bem no meio do despacho). Oferta de CORRIDA
            // pendente não bloqueia mais encomenda (P3) — a fila decide quem fica em
            // destaque.
            if (!data?._id || !canReceiveOffers() || isOfferExpired(data)) return
            if (!offerQueue.enqueue('parcel', data)) return
            addToast(
                `Nova encomenda · ${data.vehicleType?.toUpperCase() || 'entrega'} · ${formatBRL(data.fare)}`,
                'ride',
            )
            presentNativeRideOffer({
                type: 'NEW_PARCEL',
                parcelId: data._id,
                title: 'Nova encomenda disponível',
                message: `${data.pickup?.split(',')[0] || 'Coleta'} → ${data.destination?.split(',')[0] || 'Entrega'} • ${formatBRL(data.fare)}`,
                fare: data.fare,
                pickup: data.pickup,
                destination: data.destination,
                deepLink: `/captain-home?parcelOffer=${data._id}`,
            })
            if (!isNativePlatform() && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
                showBrowserNotification(
                    'Nova encomenda disponível 📦',
                    `${data.pickup?.split(',')[0] || 'Coleta'} → ${data.destination?.split(',')[0] || 'Entrega'} • ${formatBRL(data.fare)}`,
                    { tag: `parcel-${data._id}` }
                )
                console.log(`[AUDIT][${TRACE_ID}] Web Push Nativo (Browser) exibido.`)
            }
        }

        const handleParcelTaken = (data) => {
            offerEpochRef.current += 1
            if (data?.captainId && data.captainId === captain._id) return
            if (parcelAcceptRef.current?.parcelId === data?.parcelId) parcelAcceptRef.current.invalidated = true
            offerQueue.remove(data?.parcelId)
            const currentOffer = parcelOfferRef.current
            if (currentOffer && String(currentOffer._id) === String(data?.parcelId)) {
                addToast('Essa encomenda já foi aceita por outro prestador.', 'info')
            }
        }

        socket.on('new-ride', handleNewRide)
        socket.on('ride-cancelled', handleRideCancelled)
        socket.on('ride-taken', handleRideTaken)
        socket.on('new-parcel', handleNewParcel)
        socket.on('parcel-taken', handleParcelTaken)

        return () => {
            socket.off('connect', handleConnect)
            socket.off('new-ride', handleNewRide)
            socket.off('ride-cancelled', handleRideCancelled)
            socket.off('ride-taken', handleRideTaken)
            socket.off('new-parcel', handleNewParcel)
            socket.off('parcel-taken', handleParcelTaken)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [captain, socket, addToast, syncPendingParcels, syncScheduledUpcoming, offerQueue.enqueue, offerQueue.remove])

    // --- Fase B: sincronização das corridas/encomendas pendentes ---
    // Push (socket) é efêmero: se o app estava fechado, minimizado ou sem
    // rede quando o evento saiu, a oferta se perdia pra sempre. O pull nestes
    // gatilhos garante que uma oferta pendente compatível sempre reapareça.
    useEffect(() => {
        if (!captain || !captain._id) return

        syncPendingRides()
        syncPendingParcels()
        syncScheduledUpcoming()

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                syncPendingRides()
                syncPendingParcels()
                syncScheduledUpcoming()
            }
        }
        const handleOnline = () => {
            syncPendingRides()
            syncPendingParcels()
            syncScheduledUpcoming()
        }

        document.addEventListener('visibilitychange', handleVisibility)
        window.addEventListener('pageshow', handleVisibility)
        window.addEventListener('online', handleOnline)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility)
            window.removeEventListener('pageshow', handleVisibility)
            window.removeEventListener('online', handleOnline)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [captain?._id, syncPendingParcels, syncScheduledUpcoming])

    // Heads-up (2026-08-04): deep link da notificação (?rideOffer=<id>). Abre o popup
    // da oferta real consultando o backend — nunca confia só no rideId do push.
    useEffect(() => {
        const offerId = searchParams.get('rideOffer')
        if (!offerId || !captain?._id) return
        let cancelled = false
        ;(async () => {
            try {
                // Android: quando o motorista toca em "Aceitar" na notificação nativa,
                // o backend já pode ter aceitado a corrida antes da WebView montar. A
                // primeira fonte precisa ser /rides/captain-current; /rides/pending só
                // vale para ofertas ainda não aceitas. Isso evita reabrir a oferta com
                // botão "Aceitar" para uma corrida que já é ativa deste motorista.
                const activeRide = await syncCaptainRide?.()
                if (cancelled) return
                if (activeRide && String(activeRide._id) === String(offerId)) {
                    removePendingRide(offerId)
                    if (activeRide.status === 'started') {
                        navigate('/captain-riding', { replace: true, state: { ride: activeRide } })
                    } else if ([ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger' ].includes(activeRide.status)) {
                        setRide(activeRide)
                        setRidePopupPanel(false)
                        setConfirmRidePopupPanel(true)
                    }
                    return
                }

                const response = await withHardTimeout(api.get('/rides/pending'))
                if (cancelled) return
                if (!canReceiveOffers()) return
                const list = (Array.isArray(response.data) ? response.data : []).filter(item => !isOfferExpired(item))
                setPendingRides(list)
                const target = list.find(r => String(r._id) === String(offerId))
                if (target) {
                    offerQueue.enqueue('ride', target, { front: true })
                } else {
                    addToast('Essa corrida não está mais disponível.', 'info')
                }
            } catch (err) {
                console.error('Falha ao abrir oferta da notificação:', err)
            } finally {
                if (!cancelled) {
                    const next = new URLSearchParams(searchParams)
                    next.delete('rideOffer')
                    setSearchParams(next, { replace: true })
                }
            }
        })()

        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams.get('rideOffer'), captain?._id, captainRide?._id, syncCaptainRide, navigate])

    // Deep link ?parcelOffer=<id> — espelha rideOffer.
    useEffect(() => {
        const offerId = searchParams.get('parcelOffer')
        if (!offerId || !captain?._id) return
        if (captainRide || captainParcel) {
            const next = new URLSearchParams(searchParams)
            next.delete('parcelOffer')
            setSearchParams(next, { replace: true })
            return
        }

        let cancelled = false
        ;(async () => {
            try {
                const parcels = await withHardTimeout(getPendingParcels())
                if (cancelled) return
                if (!canReceiveOffers()) return
                const list = (Array.isArray(parcels) ? parcels : []).filter(item => !isOfferExpired(item))
                const target = list.find(p => String(p._id) === String(offerId))
                if (target) {
                    offerQueue.enqueue('parcel', target, { front: true })
                } else {
                    addToast('Essa encomenda não está mais disponível.', 'info')
                }
            } catch (err) {
                console.error('Falha ao abrir oferta de encomenda da notificação:', err)
            } finally {
                if (!cancelled) {
                    const next = new URLSearchParams(searchParams)
                    next.delete('parcelOffer')
                    setSearchParams(next, { replace: true })
                }
            }
        })()

        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams.get('parcelOffer'), captain?._id, captainRide?._id, captainParcel?._id])

    // Emit GPS periódico: CaptainLocationBridge (online 10s / serviço 5s).

    // ACK de recusa — espelha declineParcel e o fluxo nativo (RideOfferAcceptHelper).
    async function declineRideOffer(rideToDecline) {
        if (acceptRequestRef.current || uncertainAcceptanceRef.current) return
        const targetRide = rideToDecline || rideRef.current
        if (!targetRide?._id) {
            setRidePopupPanel(false)
            return
        }
        // Sai da fila na hora — se houver próxima oferta, o effect que espelha
        // offerQueue.active reabre o painel sozinho com ela.
        offerQueue.remove(targetRide._id)
        try {
            await withHardTimeout(api.post(`/rides/${targetRide._id}/decline`, {}))
        } catch {
            /* ACK only — sair da fila já basta pro motorista */
        }
        removePendingRide(targetRide._id)
    }

    // Destaque encerrado: retira só o popup sem recusar ou renovar o relógio.
    // O backend mantém a solicitação por mais tempo; o card ainda pode consultar/aceitar.
    function expireRideOffer(rideToExpire) {
        const targetRide = rideToExpire || rideRef.current
        if (!targetRide?._id) return
        offerQueue.remove(targetRide._id)
    }

    // Fase B: aceita um parâmetro opcional pra permitir aceitar direto do card
    // "Corrida disponível" (sem passar pelo popup) — o default preserva o fluxo do
    // RidePopUp, que chama sem argumentos.
    async function confirmRide(rideToAccept, { fromPendingList = false } = {}) {
        const targetRide = rideToAccept || rideRef.current
        if (!targetRide?._id || acceptRequestRef.current || parcelAcceptRef.current || availabilityBusyRef.current) return
        if (!fromPendingList && !uncertainAcceptanceRef.current && isOfferExpired(targetRide)) {
            expireRideOffer(targetRide)
            addToast('O prazo dessa oferta terminou. Aguarde uma nova solicitação.', 'info')
            return
        }
        if (uncertainAcceptanceRef.current && uncertainAcceptanceRef.current._id !== targetRide._id) {
            addToast('Confira o aceite pendente antes de aceitar outra corrida.', 'info')
            return
        }
        if (isRideAssignedToCaptain(captainRideRef.current, captain?._id)) return
        if (captainParcelRef.current || parcelPopupOpen) {
            addToast('Finalize a encomenda atual antes de aceitar uma corrida.', 'info')
            return
        }
        const attempt = { rideId: targetRide._id, captainId: captain?._id, invalidated: false }
        acceptRequestRef.current = attempt
        setAcceptingRideId(targetRide._id)
        setRide(targetRide)
        const isCurrent = () => mountedRef.current && !attempt.invalidated
            && captainIdRef.current === attempt.captainId
        try {
            const assigned = await acceptDriverRide(targetRide, attempt.captainId, {
                reconcileFirst: Boolean(uncertainAcceptanceRef.current),
            })
            if (!isCurrent()) return
            clearUncertainAcceptance()
            setRide(assigned)
            captainRideRef.current = assigned
            setCaptainRide(assigned)
            removePendingRide(targetRide._id)
            offerQueue.clear()
            setRidePopupPanel(false)
            setConfirmRidePopupPanel(assigned.status !== 'started')
            if (assigned._id !== targetRide._id) addToast('Você já tem uma corrida atribuída. Retomando essa viagem.', 'info')
            if (assigned.status === 'started') navigate('/captain-riding', { replace: true, state: { ride: assigned } })
        } catch (err) {
            if (!isCurrent()) return
            if (err.acceptanceUncertain) {
                uncertainAcceptanceRef.current = targetRide
                setUncertainAcceptance(targetRide)
                setRidePopupPanel(false)
                addToast('Aceite ainda não confirmado. Confira a confirmação antes de se deslocar.', 'info')
            } else if ([404, 409, 410].includes(err.response?.status)) {
                clearUncertainAcceptance()
                addToast(err.response?.data?.message || 'Essa corrida não está mais disponível.', 'info')
                removePendingRide(targetRide._id)
                offerQueue.remove(targetRide._id)
                setConfirmRidePopupPanel(false)
                setRide(null)
            } else {
                addToast(err.response?.data?.message || err.message || 'Não foi possível confirmar o aceite.', 'error')
            }
        } finally {
            if (acceptRequestRef.current === attempt) acceptRequestRef.current = null
            if (mountedRef.current) setAcceptingRideId(null)
        }
    }


    // Auditoria de UX do motorista (2026-08-02, §2.7): antes disto, um motorista fora
    // do estado 'aprovado' (ou bloqueado depois de já ter sido aprovado) entrava direto
    // na Home operacional inteira e só descobria a restrição ao tocar em "Ficar Online".
    const needsApprovalGate = captain && (captain.isBlocked || captain.approvalStatus !== 'aprovado')

    const modalRide = acceptingRideId ? ride : visibleOffer?.data
    const modalParcel = acceptingParcel || visibleOffer?.data
    const closeOperationalPanel = () => {
        if (acceptRequestRef.current || parcelAcceptRef.current || pickupBusy) return
        if (pickupOpen) setConfirmRidePopupPanel(false)
        else setDismissedOfferKey(offerKey)
    }

    async function confirmParcel(target, { fromPendingList = false } = {}) {
        if (!target?._id || parcelAcceptRef.current || acceptRequestRef.current || uncertainAcceptanceRef.current || availabilityBusyRef.current) return
        if (!canReceiveOffers() || (!fromPendingList && isOfferExpired(target))) return
        const attempt = { parcelId: target._id, captainId: captainIdRef.current, invalidated: false }
        parcelAcceptRef.current = attempt
        setAcceptingParcel(target)
        try {
            const accepted = await withHardTimeout(acceptParcel(target._id))
            if (!mountedRef.current || attempt.invalidated || captainIdRef.current !== attempt.captainId) return
            if (accepted?._id !== target._id || !['provider_accepted', 'going_to_pickup', 'arrived_pickup', 'collected', 'in_transit', 'arrived_destination'].includes(accepted.status)) {
                throw new Error('Resposta de aceite não confirmada. Confira a encomenda antes de se deslocar.')
            }
            offerQueue.clear()
            captainParcelRef.current = accepted
            setCaptainParcel(accepted)
            navigate('/captain-parcel', { state: { parcel: accepted } })
        } catch (err) {
            if (!mountedRef.current || attempt.invalidated || captainIdRef.current !== attempt.captainId) return
            addToast(err.response?.data?.message || 'Não foi possível confirmar o aceite. Confira Encomendas antes de se deslocar.', 'error')
            if (err.response?.status === 409) offerQueue.remove(target._id)
        } finally {
            if (parcelAcceptRef.current === attempt) parcelAcceptRef.current = null
            if (mountedRef.current) setAcceptingParcel(null)
        }
    }

    const notice = acceptingRideId || uncertainAcceptance ? (
        <div role="status" className="rounded-panel border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-ink-900">{acceptingRideId ? 'Confirmando aceite...' : 'Aceite ainda não confirmado'}</p>
            <p className="text-sm text-ink-700">Aguarde a confirmação antes de se deslocar.</p>
            {!acceptingRideId && <button type="button" className="mt-2 min-h-[48px] w-full rounded-panel border border-ink-700 text-ink-900 font-semibold"
                onClick={() => confirmRide(uncertainAcceptance)}>Tentar confirmar aceite</button>}
        </div>
    ) : assignedRide ? (
        assignedRide.status === 'started'
            ? <Link to="/captain-riding" state={{ ride: assignedRide }} className="flex min-h-[44px] items-center justify-center rounded-panel bg-brand-700 text-white font-semibold">Corrida em andamento — voltar</Link>
            : <button type="button" onClick={() => { setRide(assignedRide); setConfirmRidePopupPanel(true) }} className="w-full min-h-[44px] rounded-panel bg-brand-700 text-white font-semibold">Retomar embarque</button>
    ) : captainParcel?._id ? (
        <Link to="/captain-parcel" state={{ parcel: captainParcel }} className="flex min-h-[44px] items-center justify-center rounded-panel bg-brand-700 text-white font-semibold">Retomar encomenda</Link>
    ) : availabilityBusy ? (
        <Link to="/captain-home" className="flex min-h-[44px] items-center justify-center rounded-panel bg-amber-50 text-ink-900 font-semibold">Conferir disponibilidade no início</Link>
    ) : offerEntry && !visibleOffer ? (
        <button type="button" onClick={() => setDismissedOfferKey(null)} className="w-full min-h-[44px] rounded-panel bg-brand-700 text-white font-semibold">Ver oferta disponível</button>
    ) : null

    return (
        <>
        <DriverAccountShell notice={notice} modalOpen={modalOpen} operations={{
            acceptRide: target => confirmRide(target, { fromPendingList: true }),
            acceptParcel: target => confirmParcel(target, { fromPendingList: true }),
            acceptingRideId,
            acceptingParcelId: acceptingParcel?._id,
            blocked: Boolean(availabilityBusy || acceptingRideId || uncertainAcceptance || acceptingParcel || assignedRide || captainParcel || needsApprovalGate),
        }}>
            {needsApprovalGate ? (
                <div className='flex-1 overflow-y-auto overscroll-y-contain pb-20'>
                    <ApprovalGate captain={captain} onRefresh={refreshApprovalStatus} refreshing={refreshingApproval} />
                </div>
            ) : (
                <>
                    <div className='flex-1 min-h-[22%] relative z-panel'>
                        <LiveTracking ride={ride} showSearchRadius={true} />
                    </div>
                    <div className='shrink-0 max-h-[70%] min-h-0 p-3 overflow-y-auto overscroll-y-contain pb-6 bg-surface-alt'>
                        <CaptainDetails assignedRide={assignedRide}
                            busy={Boolean(acceptingRideId || uncertainAcceptance || acceptingParcel)}
                            onAvailabilityBusyChange={onAvailabilityBusyChange}>
                        {/* Fase B da experiência de corrida ativa (2026-08-03): card
                            persistente de corrida pendente. Diferente do popup (que o
                            motorista pode ignorar ou perder), este card fica na Home
                            enquanto a corrida existir como 'requested' no backend —
                            some apenas quando alguém aceita, o passageiro cancela ou
                            ela expira no servidor. Escondido se já há corrida ativa
                            (o índice único impede aceitar duas). */}
                        {!assignedRide && !captainParcel && !parcelPopupOpen && pendingRides.map(pending => {
                            const distKm = haversineKm(userLocation, pending.pickupCoordinates)
                            return (
                                <div key={pending._id} className='mb-4 bg-brand-50 border-2 border-brand-200 rounded-panel p-4'>
                                    <div className='flex items-center justify-between mb-2'>
                                        <div className='flex items-center gap-2'>
                                            <i className="ri-taxi-fill text-brand-600 text-lg" aria-hidden="true"></i>
                                            <p className='text-sm font-bold text-brand-700'>Corrida disponível</p>
                                        </div>
                                        <p className='text-base font-bold text-ink-900'>
                                            {formatBRL(pending.fare)}
                                        </p>
                                    </div>
                                    <div className='text-sm text-ink-900 space-y-1 mb-1'>
                                        <p className='flex items-start gap-2'>
                                            <i className="ri-map-pin-user-fill text-brand-500 mt-0.5" aria-hidden="true"></i>
                                            <span className='min-w-0 truncate'>{pending.pickup}</span>
                                        </p>
                                        <p className='flex items-start gap-2'>
                                            <i className="ri-map-pin-2-fill text-danger-500 mt-0.5" aria-hidden="true"></i>
                                            <span className='min-w-0 truncate'>{pending.destination}</span>
                                        </p>
                                    </div>
                                    <p className='text-xs text-ink-600 mb-3'>
                                        {vehicleLabels[pending.vehicleType] || pending.vehicleType}
                                        {distKm != null && ` • ${distKm.toFixed(1)} km em linha reta até o passageiro (aproximado)`}
                                    </p>
                                    <div className='flex gap-2'>
                                        <button
                                            type='button'
                                            disabled={Boolean(availabilityBusy || acceptingRideId || uncertainAcceptance || acceptingParcel)}
                                            onClick={() => {
                                                setRide(pending)
                                                confirmRide(pending, { fromPendingList: true })
                                            }}
                                            className='flex-1 min-h-[44px] rounded-full bg-brand-500 active:bg-brand-600 text-white text-sm font-semibold disabled:opacity-50'
                                        >
                                            <i className="ri-checkbox-circle-line mr-1" aria-hidden="true"></i>
                                            Aceitar corrida
                                        </button>
                                        <button
                                            type='button'
                                            onClick={() => { setDismissedOfferKey(null); offerQueue.enqueue('ride', pending, { front: true }) }}
                                            disabled={Boolean(availabilityBusy || acceptingRideId || uncertainAcceptance || acceptingParcel || isOfferExpired(pending))}
                                            className='flex-1 min-h-[44px] rounded-full border border-line text-ink-900 text-sm font-medium'
                                        >
                                            {isOfferExpired(pending) ? 'Destaque encerrado' : 'Ver detalhes'}
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                        {!assignedRide && !captainParcel && (
                                <>
                                    <button type="button" onClick={() => navigate('/captain-presential')}
                                        disabled={Boolean(availabilityBusy || acceptingRideId || uncertainAcceptance || acceptingParcel)}
                                        aria-label="Iniciar uma corrida presencial"
                                        className="w-full rounded-xl border border-line bg-white p-3 text-left disabled:opacity-50 min-h-[48px]">
                                        <span className="block text-sm font-semibold text-ink-900">Corrida presencial</span>
                                        <span className="block text-xs text-ink-600 mt-1">Para um passageiro que já está com você.</span>
                                    </button>
                                    {scheduledUpcoming.length > 0 && <button type="button"
                                        onClick={() => navigate('/captain/scheduled')}
                                        className="min-h-[44px] w-full text-left text-sm text-ink-700 underline">
                                        Ver serviços agendados ({scheduledUpcoming.length})
                                    </button>}
                                </>
                            )}
                        </CaptainDetails>
                    </div>
                </>
            )}
        </DriverAccountShell>
        {modalOpen && <DriverOperationalDialog
            key={modalKind === 'pickup' ? `pickup:${assignedRide._id}` : `${modalKind}:${(modalKind === 'parcel' ? modalParcel : modalRide)?._id}`}
            title={modalKind === 'pickup' ? 'Embarque da corrida' : modalKind === 'parcel' ? 'Oferta de encomenda' : 'Oferta de corrida'}
            busy={Boolean(acceptingRideId || acceptingParcel || pickupBusy)} onClose={closeOperationalPanel}>
            {modalKind === 'ride' && <RidePopUp
                    key={modalRide?._id}
                    ride={modalRide}
                    open
                    accepting={Boolean(availabilityBusy || acceptingRideId || uncertainAcceptance)}
                    setRidePopupPanel={setRidePopupPanel}
                    confirmRide={() => confirmRide(modalRide)}
                    onDecline={declineRideOffer}
                    onExpire={expireRideOffer}
                />}
            {modalKind === 'pickup' && <ConfirmRidePopUp
                    key={assignedRide._id}
                    ride={assignedRide}
                    onBusyChange={setPickupBusy}
                    setRide={setRide}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel} setRidePopupPanel={setRidePopupPanel} />}
            {modalKind === 'parcel' && <ParcelPopUp
                    key={modalParcel?._id}
                    embedded
                    accepting={Boolean(availabilityBusy || acceptingParcel)}
                    parcel={modalParcel}
                    onDecline={async () => {
                        // Sai da fila na hora — se houver próxima oferta, reabre sozinha.
                        offerQueue.remove(modalParcel._id)
                        try {
                            await declineParcel(modalParcel._id)
                        } catch {
                            /* ACK only */
                        }
                    }}
                    onAccept={() => confirmParcel(modalParcel)}
                    onExpire={(p) => offerQueue.remove(p?._id)}
                />}
        </DriverOperationalDialog>}
        </>
    )
}

export default CaptainHome
