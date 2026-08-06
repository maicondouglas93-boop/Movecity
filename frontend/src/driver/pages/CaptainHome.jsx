import React, { useRef, useState, useEffect, useContext, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import CaptainDetails from '@/driver/components/CaptainDetails'
import RidePopUp from '@/driver/components/RidePopUp'
import ConfirmRidePopUp from '@/driver/components/ConfirmRidePopUp'
import ParcelPopUp from '@/driver/components/ParcelPopUp'
import { acceptParcel, declineParcel, getPendingParcels } from '@/shared/services/parcelApi'
import ApprovalGate from '@/driver/components/ApprovalGate'
import BottomSheet from '@/shared/components/ui/BottomSheet'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { RideContext } from '@/shared/contexts/RideContext'
import api from '@/shared/services/axios'
import LiveTracking from '@/shared/components/LiveTracking'
import { useToast } from '@/shared/contexts/ToastContext'
import CaptainHeader from '@/driver/components/CaptainHeader'
import { requestFCMToken, onForegroundMessage } from '@/shared/services/fcm'
import { registerPush, bindPushNavigation } from '@/shared/platform/notification.service'
import { syncNativeCaptainSession } from '@/shared/platform/nativeSession.service'
import { vibrate } from '@/shared/platform/haptics.service'
import { isNativePlatform } from '@/shared/platform/platform'
import { syncTokenWithSW } from '@/shared/services/swCommunication'
import { useWakeLock } from '@/shared/hooks/useWakeLock'
import { enqueueOfflineAction, flushQueuedLocations } from '@/shared/services/offlineQueue'
import { getAccessToken } from '@/shared/services/session'
import { joinWithRetry } from '@/shared/services/socketAuth'
import { showBrowserNotification } from '@/shared/services/browserNotify'
import { presentNativeRideOffer } from '@/shared/platform/nativeRideOffer.service'
import { vehicleLabels } from '@/shared/assets/vehicleAssets'
import * as Sentry from '@sentry/react'

const haversineKm = (a, b) => {
    if (!a || !b || a.lat == null || b.lat == null) return null
    const toRad = (v) => (v * Math.PI) / 180
    const R = 6371
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const sinA = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(sinA), Math.sqrt(1 - sinA))
}

const CaptainHome = () => {

    const [ ridePopupPanel, setRidePopupPanel ] = useState(false)
    const [ confirmRidePopupPanel, setConfirmRidePopupPanel ] = useState(false)
    const [ showNotificationPrompt, setShowNotificationPrompt ] = useState(false)
    const [ searchParams, setSearchParams ] = useSearchParams()
    // Auditoria PWA (2026-08-03, C3): antes, permissão "negada" não gerava nenhum
    // aviso — um motorista nesse estado ficava invisível ao despacho por push (com o
    // app fechado/minimizado) sem nenhuma pista de causa dentro do app.
    const [ notificationsDenied, setNotificationsDenied ] = useState(false)

    const [ ride, setRide ] = useState(null)
    // Fase B da experiência de corrida ativa (2026-08-03): corridas 'requested'
    // compatíveis vindas do pull GET /rides/pending — a fonte persistente das ofertas.
    // O evento 'new-ride' (socket) só adiciona/atualiza; quem garante que nada se perde
    // é a sincronização no mount, no reconnect, no retorno do background e no 'online'.
    const [ pendingRides, setPendingRides ] = useState([])
    const [ parcelOffer, setParcelOffer ] = useState(null)
    const [ parcelPopupOpen, setParcelPopupOpen ] = useState(false)
    const [ scheduledUpcoming, setScheduledUpcoming ] = useState([])

    const navigate = useNavigate()
    const { socket } = useContext(SocketContext)
    const { captain, setCaptain } = useContext(CaptainDataContext)
    const { locationRef, locationError, userLocation } = useContext(LocationContext)
    const { captainRide, setCaptainRide, setCaptainParcel, captainParcel } = useContext(RideContext)
    const { addToast } = useToast()
    const [ refreshingApproval, setRefreshingApproval ] = useState(false)

    const removePendingRide = (rideId) => {
        setPendingRides(prev => prev.filter(r => r._id !== rideId))
    }

    const syncPendingRides = async () => {
        try {
            const response = await api.get('/rides/pending')
            setPendingRides(Array.isArray(response.data) ? response.data : [])
        } catch (err) {
            // Sem rede/token vencido: mantém a lista atual; a próxima sincronização
            // (reconnect/visibilidade/online) corrige.
            console.error('Falha ao sincronizar corridas pendentes:', err)
        }
    }

    // Fase A da experiência de corrida ativa (2026-08-03): restauração da corrida
    // aceita (pré-início). Antes, um refresh com corrida em 'accepted'/'going_to_pickup'/
    // 'arrived' deixava a Home vazia — os botões "A caminho"/"Cheguei"/PIN sumiam, mas o
    // motorista continuava vinculado à corrida no banco (índice único), travado sem UI.
    // O RideContext consulta /rides/captain-current a cada abertura/reconexão/retorno do
    // background; aqui só reabrimos o painel certo com o status real do backend.
    // Corrida 'started' não passa por aqui: o RideContext redireciona pra /captain-riding.
    useEffect(() => {
        if (!captainRide) return
        // Presencial: PIN/confirmação tem tela própria (não o popup de corrida despachada).
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
    }, [captainRide?._id, captainRide?.status, captainRide?.source, navigate])

    // Auditoria de UX do motorista (2026-08-02, §2.7): busca o perfil de novo sob
    // demanda (botão "Verificar novamente" do ApprovalGate) — o contexto só é
    // atualizado no login/refresh de página, então um motorista aprovado enquanto o
    // app estava aberto continuaria vendo a tela de bloqueio até fechar e reabrir.
    const refreshApprovalStatus = async ({ silent = false } = {}) => {
        setRefreshingApproval(true)
        try {
            const response = await api.get('/captains/profile')
            const next = response.data.captain
            setCaptain(next)
            if (!silent) {
                if (next?.approvalStatus === 'aprovado' && !next?.isBlocked) {
                    addToast('Cadastro aprovado! Você já pode ficar online.', 'success')
                } else {
                    addToast(`Status atual: ${next?.approvalStatus || 'desconhecido'}`, 'info')
                }
            }
        } catch (err) {
            console.error('Failed to refresh approval status:', err)
            if (!silent) {
                addToast(err.friendlyMessage || 'Não foi possível atualizar o status. Verifique a conexão.', 'error')
            }
        } finally {
            setRefreshingApproval(false)
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

    // Auditoria de UX do motorista (2026-08-02, §2.5): sem GPS, updateLocation() (efeito
    // abaixo) simplesmente retorna cedo e a posição do motorista para de ser atualizada
    // no servidor — ele some do raio de despacho enquanto a tela continua dizendo
    // "Procurando corridas...". Sem isso, o motorista não tinha como saber por que não
    // estava recebendo nada. Edge-triggered (só quando o erro aparece), pra não repetir
    // o toast a cada render enquanto o problema persiste.
    useEffect(() => {
        if (locationError) {
            addToast(`Sem sinal de GPS: ${locationError} Você pode não estar recebendo corridas.`, 'error')
        }
    }, [locationError])

    // Espelha JWT + API base no SharedPreferences (Aceitar com app morto / lock screen).
    useEffect(() => {
        const token = getAccessToken('captain')
        if (token) syncNativeCaptainSession({ token }).catch(() => {})
    }, [])

    // Push: Web = FCM/SW; Android nativo = Capacitor Push (notification.service).
    useEffect(() => {
        const setupPush = async () => {
            if (isNativePlatform()) {
                await registerPush()
                return
            }
            if (!('Notification' in window)) return
            if (Notification.permission === 'granted') {
                await requestFCMToken()
                const jwt = getAccessToken('captain')
                if (jwt) await syncTokenWithSW(jwt)
            } else if (Notification.permission === 'default' && !localStorage.getItem('notificationPromptSeenCaptain')) {
                setShowNotificationPrompt(true)
            } else if (Notification.permission === 'denied') {
                setNotificationsDenied(true)
            }
        }
        setupPush()
    }, [])

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

    const handleEnableNotifications = async () => {
        setShowNotificationPrompt(false)
        localStorage.setItem('notificationPromptSeenCaptain', '1')
        if (isNativePlatform()) {
            await registerPush()
            return
        }
        const permission = await Notification.requestPermission()
        if (permission === 'granted') {
            await requestFCMToken()
            const jwt = getAccessToken('captain')
            if (jwt) await syncTokenWithSW(jwt)
        }
    }

    const handleDismissNotifications = () => {
        setShowNotificationPrompt(false)
        localStorage.setItem('notificationPromptSeenCaptain', '1')
    }

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

    const syncScheduledUpcoming = useCallback(async () => {
        try {
            const { data } = await api.get('/captains/scheduled-upcoming')
            setScheduledUpcoming(data.upcoming || [])
        } catch {
            /* ignore */
        }
    }, [])

    const syncPendingParcels = useCallback(async () => {
        if (captainRideRef.current || captainParcelRef.current) return
        try {
            const parcels = await getPendingParcels()
            if (Array.isArray(parcels) && parcels.length) {
                setParcelOffer(parcels[0])
                setParcelPopupOpen(true)
            }
        } catch {
            /* ignore */
        }
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
                flushQueuedLocations(socket).catch(e => console.error(e))
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
            const TRACE_ID = `Ride:${data._id}`;
            console.log(`[AUDIT][${TRACE_ID}] Evento 'new-ride' recebido no Frontend via Socket. Dados:`, data);

            if (captainParcelRef.current || parcelOfferRef.current) return

            setRide(data)
            setRidePopupPanel(true)
            // Fase B: a oferta também entra na lista persistente — se o motorista
            // ignorar o popup, ela continua acessível no card "Corrida disponível".
            setPendingRides(prev => {
                const rest = prev.filter(r => r._id !== data._id)
                return [ data, ...rest ]
            })
            console.log(`[AUDIT][${TRACE_ID}] Modal RidePopUp ativado.`);

            try {
                const audio = new Audio('/sounds/new-ride.wav');
                audio.play().then(() => {
                    console.log(`[AUDIT][${TRACE_ID}] Som de notificação tocado com sucesso.`);
                }).catch(e => {
                    console.warn(`[AUDIT][${TRACE_ID}] Falha ao tocar som (Autoplay bloqueado?):`, e);
                });
                
                vibrate([500, 200, 500])
                console.log(`[AUDIT][${TRACE_ID}] Vibração acionada.`);
            } catch (err) {
                console.error(`[AUDIT][${TRACE_ID}] Erro nas APIs de mídia:`, err);
            }

            addToast(`Nova solicitação de ${data.vehicleType?.toUpperCase() || 'corrida'} de ${data.user?.fullname?.firstname || 'um passageiro'}!`, 'ride')

            // APK: tela cheia nativa na hora (FSI vira só heads-up com tela desbloqueada).
            presentNativeRideOffer({
                type: 'NEW_RIDE',
                rideId: data._id,
                title: 'Nova Solicitação de Corrida!',
                message: `${data.pickup?.split(',')[0] || 'Origem'} → ${data.destination?.split(',')[0] || 'Destino'} • R$${data.fare}`,
                fare: data.fare,
                pickup: data.pickup,
                destination: data.destination,
                deepLink: `/captain-home?rideOffer=${data._id}`,
            })

            if (!isNativePlatform() && 'Notification' in window && Notification.permission === 'granted') {
                showBrowserNotification(
                    'Nova Solicitação de Corrida! 🚗',
                    `${data.pickup?.split(',')[0]} → ${data.destination?.split(',')[0]} • R$${data.fare}`
                )
                console.log(`[AUDIT][${TRACE_ID}] Web Push Nativo (Browser) exibido.`);
            } else {
                console.log(`[AUDIT][${TRACE_ID}] Web Push não exibido (Sem permissão ou API inexistente). Permissão atual:`, Notification.permission);
            }
        }

        const handleRideCancelled = (data) => {
            // Fase B: a corrida deixa de estar disponível — sai do card persistente.
            const cancelledId = data?.rideId
            removePendingRide(cancelledId)
            const matchesActive =
                (rideRef.current && String(rideRef.current._id) === String(cancelledId)) ||
                (captainRideRef.current && String(captainRideRef.current._id) === String(cancelledId))
            if (matchesActive) {
                // Fase A da experiência de corrida ativa (2026-08-03): também fecha o
                // ConfirmRidePopUp e limpa o RideContext — antes só o popup de oferta
                // fechava, e um cancelamento após o aceite deixava a tela de "A caminho/
                // Cheguei/PIN" pendurada com uma corrida que já não existia.
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

            if (rideRef.current && rideRef.current._id === data.rideId) {
                // Fecha os DOIS painéis: o RidePopUp abre o ConfirmRidePopUp de forma
                // otimista antes da resposta da API — um perdedor com o confirm aberto
                // ficava com ele pendurado quando só o popup de oferta era fechado.
                setRidePopupPanel(false)
                setConfirmRidePopupPanel(false)
                setRide(null)
                addToast('Essa corrida já foi aceita por outro motorista.', 'info')
            }
        }

        const handleNewParcel = (data) => {
            const TRACE_ID = `Parcel:${data._id}`
            if (captainRideRef.current || rideRef.current || captainParcelRef.current) return
            setParcelOffer(data)
            setParcelPopupOpen(true)
            setRidePopupPanel(false)
            try {
                const audio = new Audio('/sounds/new-ride.wav')
                audio.play().catch(() => {})
            } catch { /* ignore */ }
            vibrate([500, 200, 500])
            addToast(
                `Nova encomenda · ${data.vehicleType?.toUpperCase() || 'entrega'} · R$ ${Number(data.fare || 0).toFixed(2)}`,
                'ride',
            )
            presentNativeRideOffer({
                type: 'NEW_PARCEL',
                parcelId: data._id,
                title: 'Nova encomenda disponível',
                message: `${data.pickup?.split(',')[0] || 'Coleta'} → ${data.destination?.split(',')[0] || 'Entrega'} • R$${data.fare}`,
                fare: data.fare,
                pickup: data.pickup,
                destination: data.destination,
                deepLink: `/captain-home?parcelOffer=${data._id}`,
            })
            if (!isNativePlatform() && 'Notification' in window && Notification.permission === 'granted') {
                showBrowserNotification(
                    'Nova encomenda disponível 📦',
                    `${data.pickup?.split(',')[0] || 'Coleta'} → ${data.destination?.split(',')[0] || 'Entrega'} • R$${data.fare}`,
                )
                console.log(`[AUDIT][${TRACE_ID}] Web Push Nativo (Browser) exibido.`)
            }
        }

        const handleParcelTaken = (data) => {
            if (data?.captainId && data.captainId === captain._id) return
            const currentOffer = parcelOfferRef.current
            if (currentOffer && String(currentOffer._id) === String(data?.parcelId)) {
                setParcelPopupOpen(false)
                setParcelOffer(null)
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
    }, [captain, socket, addToast, syncPendingParcels, syncScheduledUpcoming])

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
        // Já em corrida ativa: não sobrescreve com uma oferta.
        if (captainRide) {
            const next = new URLSearchParams(searchParams)
            next.delete('rideOffer')
            setSearchParams(next, { replace: true })
            return
        }

        let cancelled = false
        ;(async () => {
            try {
                const response = await api.get('/rides/pending')
                if (cancelled) return
                const list = Array.isArray(response.data) ? response.data : []
                setPendingRides(list)
                const target = list.find(r => String(r._id) === String(offerId))
                if (target) {
                    setRide(target)
                    setRidePopupPanel(true)
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
    }, [searchParams.get('rideOffer'), captain?._id, captainRide?._id])

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
                const parcels = await getPendingParcels()
                if (cancelled) return
                const list = Array.isArray(parcels) ? parcels : []
                const target = list.find(p => String(p._id) === String(offerId))
                if (target) {
                    setParcelOffer(target)
                    setParcelPopupOpen(true)
                    setRidePopupPanel(false)
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
        const targetRide = rideToDecline || rideRef.current
        setRidePopupPanel(false)
        if (!targetRide?._id) return
        try {
            await api.post(`/rides/${targetRide._id}/decline`, {})
        } catch {
            /* ACK only — fechar o popup já basta pro motorista */
        }
        removePendingRide(targetRide._id)
    }

    // Fase B: aceita um parâmetro opcional pra permitir aceitar direto do card
    // "Corrida disponível" (sem passar pelo popup) — o default preserva o fluxo do
    // RidePopUp, que chama sem argumentos.
    async function confirmRide(rideToAccept) {
        const targetRide = rideToAccept || rideRef.current
        if (!targetRide?._id) return
        if (captainParcelRef.current || parcelPopupOpen) {
            addToast('Finalize a encomenda atual antes de aceitar uma corrida.', 'info')
            return
        }
        try {
            // Endpoint atômico (P1.3 da auditoria de concorrência, 2026-08-01) — antes
            // usava /rides/confirm, que sobrescrevia sem checar status: dois motoristas
            // aceitando a mesma corrida ao mesmo tempo recebiam 200 os dois.
            const response = await api.post(`/rides/${targetRide._id}/accept`, {})

            if (response.data) {
                setRide(response.data)
                // Espelha no RideContext na hora — é ele quem restaura a corrida num
                // refresh e alimenta o efeito de restauração acima.
                setCaptainRide(response.data)
            }
            removePendingRide(targetRide._id)
            setRidePopupPanel(false)
            setConfirmRidePopupPanel(true)
        } catch (err) {
            console.error('Confirm ride error:', err);
            if (err.response?.status === 409) {
                // Outro motorista já aceitou — desfecho esperado da concorrência, não um
                // erro de rede. Fecha os DOIS painéis: o RidePopUp (botão "Aceitar" já
                // abre o ConfirmRidePopUp de forma otimista, antes da resposta da API,
                // pro caso de rede offline — sem fechar os dois aqui, um 409 real deixava
                // o ConfirmRidePopUp pendurado aberto com a corrida zerada, Etapa 6 da
                // auditoria de UX, 2026-08-02).
                addToast('Essa corrida já foi aceita por outro motorista.', 'info');
                removePendingRide(targetRide._id)
                setRidePopupPanel(false)
                setConfirmRidePopupPanel(false)
                setRide(null)
            } else if (!navigator.onLine || err.code === 'ERR_NETWORK') {
                enqueueOfflineAction({
                    type: 'accept-ride',
                    rideId: targetRide._id,
                    payload: { rideId: targetRide._id }
                }).catch(e => console.error(e));

                // Optimistic UI updates
                const optimisticRide = { ...targetRide, status: 'accepted', captain };
                setRide(optimisticRide);
                removePendingRide(targetRide._id)
                setRidePopupPanel(false)
                setConfirmRidePopupPanel(true)
            } else {
                addToast('Falha ao confirmar corrida. Pode já ter sido aceita.', 'error');
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
            }
        }
    }


    // Auditoria de UX do motorista (2026-08-02, §2.7): antes disto, um motorista fora
    // do estado 'aprovado' (ou bloqueado depois de já ter sido aprovado) entrava direto
    // na Home operacional inteira e só descobria a restrição ao tocar em "Ficar Online".
    const needsApprovalGate = captain && (captain.isBlocked || captain.approvalStatus !== 'aprovado')

    return (
        <div className='h-screen flex flex-col overflow-hidden bg-surface-alt'>
            <ConnectionBanner />

            {/* Fase A da experiência de corrida ativa (2026-08-03): atalho de volta à
                corrida em andamento — o RideContext redireciona uma vez por corrida na
                restauração, mas se o motorista voltar à Home de propósito (botão Home do
                CaptainRiding) este é o caminho visível de retorno. */}
            {/* Abaixo do CaptainHeader (fixed top-0 z-[60] ~64px) — antes ficava em
                top-3/z-40 e o header tampava o atalho por completo. */}
            {captainRide?.status === 'started' && (
                <Link
                    to='/captain-riding'
                    state={{ ride: captainRide }}
                    className='fixed top-[4.75rem] left-1/2 -translate-x-1/2 z-[55] flex items-center gap-2 bg-brand-500 text-white font-semibold text-sm px-5 py-3 rounded-full shadow-floating active:scale-95 transition-transform'
                >
                    <i className="ri-navigation-fill" aria-hidden="true"></i>
                    Corrida em andamento — voltar
                </Link>
            )}

            {needsApprovalGate ? (
                <div className='flex-1 overflow-y-auto overscroll-y-contain pb-20'>
                    <ApprovalGate captain={captain} onRefresh={refreshApprovalStatus} refreshing={refreshingApproval} />
                </div>
            ) : (
                <>
                    <div className='h-[40vh] relative shadow-raised z-panel'>
                        <LiveTracking ride={ride} showSearchRadius={true} />
                    </div>
                    <div className='h-[60vh] p-4 overflow-y-auto overscroll-y-contain pb-24 bg-surface-alt'>
                        {/* Fase B da experiência de corrida ativa (2026-08-03): card
                            persistente de corrida pendente. Diferente do popup (que o
                            motorista pode ignorar ou perder), este card fica na Home
                            enquanto a corrida existir como 'requested' no backend —
                            some apenas quando alguém aceita, o passageiro cancela ou
                            ela expira no servidor. Escondido se já há corrida ativa
                            (o índice único impede aceitar duas). */}
                        {!captainRide && !captainParcel && !parcelPopupOpen && pendingRides.length > 0 && pendingRides.map(pending => {
                            const distKm = haversineKm(userLocation, pending.pickupCoordinates)
                            return (
                                <div key={pending._id} className='mb-4 bg-brand-50 border-2 border-brand-200 rounded-panel p-4'>
                                    <div className='flex items-center justify-between mb-2'>
                                        <div className='flex items-center gap-2'>
                                            <i className="ri-taxi-fill text-brand-600 text-lg" aria-hidden="true"></i>
                                            <p className='text-sm font-bold text-brand-700'>Corrida disponível</p>
                                        </div>
                                        <p className='text-base font-bold text-ink-900'>
                                            R$ {pending.fare?.toFixed ? pending.fare.toFixed(2) : pending.fare}
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
                                        {distKm != null && ` • ${distKm.toFixed(1)} km até o passageiro`}
                                    </p>
                                    <div className='flex gap-2'>
                                        <button
                                            type='button'
                                            onClick={() => {
                                                setRide(pending)
                                                confirmRide(pending)
                                            }}
                                            className='flex-1 min-h-[44px] rounded-full bg-brand-500 active:bg-brand-600 text-white text-sm font-semibold'
                                        >
                                            <i className="ri-checkbox-circle-line mr-1" aria-hidden="true"></i>
                                            Aceitar corrida
                                        </button>
                                        <button
                                            type='button'
                                            onClick={() => {
                                                setRide(pending)
                                                setRidePopupPanel(true)
                                            }}
                                            className='flex-1 min-h-[44px] rounded-full border border-line text-ink-900 text-sm font-medium'
                                        >
                                            Ver detalhes
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                        {showNotificationPrompt && (
                            <div className="mb-4 bg-surface-alt border border-line rounded-panel p-4 flex gap-3">
                                <i className="ri-notification-3-fill text-brand-500 text-xl flex-shrink-0 mt-0.5" aria-hidden="true"></i>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-ink-900">Ativar notificações?</p>
                                    <p className="text-xs text-ink-400 mt-0.5">Avisamos de novas corridas mesmo com o app em segundo plano.</p>
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
                            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-panel p-4 flex gap-3">
                                <i className="ri-notification-off-fill text-amber-600 text-xl flex-shrink-0 mt-0.5" aria-hidden="true"></i>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-ink-900">Notificações bloqueadas</p>
                                    <p className="text-xs text-ink-400 mt-0.5">Você não vai receber avisos de corrida com o app fechado ou minimizado. Ative nas configurações de notificação do navegador para este site.</p>
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

                        <CaptainDetails>
                            {!captainRide && !captainParcel && (
                                <>
                                    {/* GO solto — corrida presencial, sem card e sem vizinhos */}
                                    <div className="flex flex-col items-center py-1 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => navigate('/captain-presential')}
                                            aria-label="Iniciar uma corrida presencial"
                                            className="relative w-16 h-16 rounded-full bg-brand-500 text-white flex items-center justify-center shadow-floating active:scale-95 animate-go-pulse"
                                        >
                                            <span
                                                className="absolute inset-0 rounded-full bg-brand-500 animate-go-ring pointer-events-none"
                                                aria-hidden="true"
                                            />
                                            <span className="relative text-lg font-black tracking-wide">GO</span>
                                        </button>
                                        <p className="text-xs font-semibold text-ink-600">
                                            Iniciar uma corrida
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-[11px] font-bold tracking-wider text-ink-400 uppercase mb-2.5 px-0.5">
                                            Escolha o modo
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div
                                                className="relative flex flex-col bg-white border-2 border-brand-500 rounded-2xl p-2.5 min-h-[120px] shadow-raised"
                                                aria-current="true"
                                            >
                                                <span
                                                    className="absolute top-2 right-2 w-5 h-5 rounded-full bg-brand-500 text-white flex items-center justify-center"
                                                    aria-hidden="true"
                                                >
                                                    <i className="ri-check-line text-xs leading-none" />
                                                </span>
                                                <i className="ri-taxi-line text-lg text-[#0B3D2E]" aria-hidden="true" />
                                                <p className="text-[12px] font-bold text-ink-900 mt-2 leading-snug">
                                                    Corrida pelo MoveCity
                                                </p>
                                                <p className="text-[10px] text-ink-600 mt-1 leading-snug">
                                                    Receba solicitações de passageiros próximos.
                                                </p>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => navigate('/captain/parcels')}
                                                className="relative flex flex-col bg-white border border-line rounded-2xl p-2.5 min-h-[120px] shadow-raised text-left active:scale-[0.98] transition-transform"
                                            >
                                                <i className="ri-user-star-line text-lg text-[#0B3D2E]" aria-hidden="true" />
                                                <p className="text-[12px] font-bold text-ink-900 mt-2 leading-snug">
                                                    Encomendas
                                                </p>
                                                <p className="text-[10px] text-ink-600 mt-1 leading-snug">
                                                    Faça entregas e coletas para seus clientes.
                                                </p>
                                            </button>
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => navigate('/captain/scheduled')}
                                        className="w-full text-left bg-white border border-line rounded-2xl p-3.5 active:scale-[0.99] transition-transform shadow-raised"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-semibold text-ink-900 flex items-center gap-2">
                                                <i className="ri-calendar-event-line text-brand-600" aria-hidden="true" />
                                                Serviços agendados
                                            </p>
                                            {scheduledUpcoming.length > 0 && (
                                                <span className="text-xs font-bold bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
                                                    {scheduledUpcoming.length}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-ink-600 mt-1">
                                            {scheduledUpcoming.length > 0
                                                ? `Próximo: ${new Date(scheduledUpcoming[0].scheduledAt).toLocaleString('pt-BR', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })} · ${scheduledUpcoming[0].kind === 'parcel' ? 'encomenda' : 'corrida'}`
                                                : 'Prévia filtrada (raio e veículo). Aceite só na oferta real.'}
                                        </p>
                                    </button>
                                </>
                            )}
                        </CaptainDetails>
                    </div>
                </>
            )}
            <BottomSheet expandable open={ridePopupPanel} onClose={() => declineRideOffer(ride)}>
                <RidePopUp
                    ride={ride}
                    open={ridePopupPanel}
                    setRidePopupPanel={setRidePopupPanel}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel}
                    confirmRide={confirmRide}
                    onDecline={declineRideOffer}
                />
            </BottomSheet>
            <BottomSheet expandable open={confirmRidePopupPanel} onClose={() => setConfirmRidePopupPanel(false)}>
                <ConfirmRidePopUp
                    ride={ride}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel} setRidePopupPanel={setRidePopupPanel} />
            </BottomSheet>
            {parcelPopupOpen && parcelOffer && (
                <ParcelPopUp
                    parcel={parcelOffer}
                    onDecline={async () => {
                        try {
                            await declineParcel(parcelOffer._id)
                        } catch {
                            /* ACK only */
                        }
                        setParcelPopupOpen(false)
                        setParcelOffer(null)
                    }}
                    onAccept={async () => {
                        try {
                            const accepted = await acceptParcel(parcelOffer._id)
                            setParcelPopupOpen(false)
                            setParcelOffer(null)
                            setCaptainParcel(accepted)
                            navigate('/captain-parcel', { state: { parcel: accepted } })
                        } catch (err) {
                            addToast(err.response?.data?.message || 'Não foi possível aceitar', 'error')
                            if (err.response?.status === 409) {
                                setParcelPopupOpen(false)
                                setParcelOffer(null)
                            }
                        }
                    }}
                />
            )}
            <CaptainHeader />
        </div>
    )
}

export default CaptainHome