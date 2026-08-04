import React, { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import CaptainDetails from '@/modules/driver/components/CaptainDetails'
import RidePopUp from '@/modules/driver/components/RidePopUp'
import ConfirmRidePopUp from '@/modules/driver/components/ConfirmRidePopUp'
import ApprovalGate from '@/modules/driver/components/ApprovalGate'
import BottomSheet from '@/shared/components/ui/BottomSheet'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'
import { useEffect, useContext } from 'react'
import { SocketContext } from '@/contexts/SocketContext'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { LocationContext } from '@/contexts/LocationContext'
import { RideContext } from '@/contexts/RideContext'
import axios from 'axios'
import LiveTracking from '@/shared/components/LiveTracking'
import { useToast } from '@/contexts/ToastContext'
import CaptainHeader from '@/modules/driver/components/CaptainHeader'
import { requestFCMToken, onForegroundMessage } from '@/services/fcm'
import { syncTokenWithSW } from '@/services/swCommunication'
import { useWakeLock } from '@/shared/hooks/useWakeLock'
import { db } from '@/services/db'
import { enqueueOfflineAction, flushQueuedLocations } from '@/services/offlineQueue'
import { getAccessToken } from '@/services/session'
import { joinWithRetry } from '@/services/socketAuth'
import { showBrowserNotification } from '@/services/browserNotify'
import { vehicleLabels } from '@/assets/vehicleAssets'
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

    const { socket } = useContext(SocketContext)
    const { captain, setCaptain } = useContext(CaptainDataContext)
    const { locationRef, locationError, userLocation } = useContext(LocationContext)
    const { captainRide, setCaptainRide } = useContext(RideContext)
    const { addToast } = useToast()
    const [ refreshingApproval, setRefreshingApproval ] = useState(false)

    const removePendingRide = (rideId) => {
        setPendingRides(prev => prev.filter(r => r._id !== rideId))
    }

    const syncPendingRides = async () => {
        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/pending`, {
                headers: { Authorization: `Bearer ${getAccessToken('captain')}` }
            })
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
        if ([ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger' ].includes(captainRide.status)) {
            setRide(captainRide)
            setRidePopupPanel(false)
            setConfirmRidePopupPanel(true)
        }
    }, [captainRide?._id, captainRide?.status])

    // Auditoria de UX do motorista (2026-08-02, §2.7): busca o perfil de novo sob
    // demanda (botão "Verificar novamente" do ApprovalGate) — o contexto só é
    // atualizado no login/refresh de página, então um motorista aprovado enquanto o
    // app estava aberto continuaria vendo a tela de bloqueio até fechar e reabrir.
    const refreshApprovalStatus = async () => {
        setRefreshingApproval(true)
        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/captains/profile`, {
                headers: { Authorization: `Bearer ${getAccessToken('captain')}` }
            })
            setCaptain(response.data.captain)
        } catch (err) {
            console.error('Failed to refresh approval status:', err)
        } finally {
            setRefreshingApproval(false)
        }
    }

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

    // C3 da auditoria de push (2026-08-02): antes só buscava o token FCM se a permissão
    // JÁ estivesse concedida — nada no app do motorista jamais chamava
    // Notification.requestPermission(), então um motorista novo nunca era convidado e
    // nunca gerava token. Mesmo padrão do passageiro (Home.jsx): cartão de contexto antes
    // do prompt nativo, pra não estourar o "Bloquear" que os navegadores nunca deixam
    // perguntar de novo.
    useEffect(() => {
        const setupFCM = async () => {
            if (!('Notification' in window)) return;
            if (Notification.permission === 'granted') {
                await requestFCMToken();
                // JWT no IndexedDB do SW de push — sem isto o Aceitar da notificação
                // falha com "sessão expirada" mesmo com o motorista logado no app.
                const jwt = getAccessToken('captain');
                if (jwt) await syncTokenWithSW(jwt);
            } else if (Notification.permission === 'default' && !localStorage.getItem('notificationPromptSeenCaptain')) {
                setShowNotificationPrompt(true);
            } else if (Notification.permission === 'denied') {
                setNotificationsDenied(true);
            }
        };
        setupFCM();
    }, [])

    // A9 da auditoria de push (2026-08-02): com o app ABERTO, o Firebase não mostra
    // notificação nativa sozinho — sem escutar aqui, uma notificação que chegasse por
    // push enquanto o motorista está olhando a tela não aparecia em lugar nenhum.
    useEffect(() => {
        const unsubscribe = onForegroundMessage((payload) => {
            // Auditoria PWA (2026-08-03, M5): NEW_RIDE já tem um caminho próprio e mais
            // rápido — handleNewRide, abaixo, via Socket.IO — com som, vibração,
            // notificação nativa E toast. Deixar este listener genérico também mostrar
            // toast pro mesmo evento gerava dois avisos descoordenados pra mesma
            // corrida sempre que os dois canais entregassem quase juntos.
            if (payload?.data?.type === 'NEW_RIDE') return;

            const title = payload?.notification?.title || payload?.data?.title;
            const body = payload?.notification?.body || payload?.data?.message;
            if (title || body) {
                addToast([title, body].filter(Boolean).join(' — '), 'info');
            }
        });
        return () => unsubscribe();
    }, [addToast]);

    const handleEnableNotifications = async () => {
        setShowNotificationPrompt(false)
        localStorage.setItem('notificationPromptSeenCaptain', '1')
        const permission = await Notification.requestPermission()
        if (permission === 'granted') {
            await requestFCMToken();
            const jwt = getAccessToken('captain');
            if (jwt) await syncTokenWithSW(jwt);
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

    // Ref para acessar o ride atual dentro de handlers sem precisar re-subscrever
    const rideRef = useRef(ride)
    useEffect(() => { rideRef.current = ride }, [ride])

    // Mesmo motivo: handleRideTaken precisa saber se a corrida do evento já é DESTE
    // motorista (aceite confirmado pelo backend) sem re-subscrever os listeners.
    const captainRideRef = useRef(captainRide)
    useEffect(() => { captainRideRef.current = captainRide }, [captainRide])

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
                // Fase B: reconexão pode ter perdido eventos 'new-ride' — o pull recupera.
                syncPendingRides()
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
                
                if (navigator.vibrate) {
                    navigator.vibrate([500, 200, 500]);
                    console.log(`[AUDIT][${TRACE_ID}] Vibração acionada.`);
                }
            } catch (err) {
                console.error(`[AUDIT][${TRACE_ID}] Erro nas APIs de mídia:`, err);
            }

            addToast(`Nova solicitação de ${data.vehicleType?.toUpperCase() || 'corrida'} de ${data.user?.fullname?.firstname || 'um passageiro'}!`, 'ride')

            if ('Notification' in window && Notification.permission === 'granted') {
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
            removePendingRide(data.rideId)
            if (rideRef.current && rideRef.current._id === data.rideId) {
                // Fase A da experiência de corrida ativa (2026-08-03): também fecha o
                // ConfirmRidePopUp e limpa o RideContext — antes só o popup de oferta
                // fechava, e um cancelamento após o aceite deixava a tela de "A caminho/
                // Cheguei/PIN" pendurada com uma corrida que já não existia.
                setRidePopupPanel(false)
                setConfirmRidePopupPanel(false)
                setRide(null)
                setCaptainRide(null)
                addToast('A corrida foi cancelada pelo passageiro.', 'info')
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

        socket.on('new-ride', handleNewRide)
        socket.on('ride-cancelled', handleRideCancelled)
        socket.on('ride-taken', handleRideTaken)

        return () => {
            socket.off('connect', handleConnect)
            socket.off('new-ride', handleNewRide)
            socket.off('ride-cancelled', handleRideCancelled)
            socket.off('ride-taken', handleRideTaken)
        }
    }, [captain, socket])

    // --- Fase B: sincronização das corridas pendentes ---
    // Push (socket 'new-ride') é efêmero: se o app estava fechado, minimizado ou sem
    // rede quando o evento saiu, a oferta se perdia pra sempre. O pull nestes quatro
    // gatilhos (mount, reconnect — no handleConnect acima —, retorno do background e
    // volta da rede) garante que uma corrida pendente compatível sempre reapareça.
    useEffect(() => {
        if (!captain || !captain._id) return

        syncPendingRides()

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') syncPendingRides()
        }
        const handleOnline = () => syncPendingRides()

        document.addEventListener('visibilitychange', handleVisibility)
        window.addEventListener('pageshow', handleVisibility)
        window.addEventListener('online', handleOnline)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility)
            window.removeEventListener('pageshow', handleVisibility)
            window.removeEventListener('online', handleOnline)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [captain?._id])

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
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/pending`, {
                    headers: { Authorization: `Bearer ${getAccessToken('captain')}` }
                })
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

    // --- Efeito 2: envio periódico da localização real (GPS) do motorista ---
    const REAL_LOCATION_INTERVAL_MS = 10000

    useEffect(() => {
        if (!captain || !captain._id) return;

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

        return () => {
            clearInterval(locationInterval);
        }
    }, [captain, socket])


    // Fase B: aceita um parâmetro opcional pra permitir aceitar direto do card
    // "Corrida disponível" (sem passar pelo popup) — o default preserva o fluxo do
    // RidePopUp, que chama sem argumentos.
    async function confirmRide(rideToAccept) {
        const targetRide = rideToAccept || rideRef.current
        if (!targetRide?._id) return
        try {
            // Endpoint atômico (P1.3 da auditoria de concorrência, 2026-08-01) — antes
            // usava /rides/confirm, que sobrescrevia sem checar status: dois motoristas
            // aceitando a mesma corrida ao mesmo tempo recebiam 200 os dois.
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/${targetRide._id}/accept`, {}, {
                headers: {
                    Authorization: `Bearer ${getAccessToken('captain')}`
                }
            })

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
                    <div className='h-[60vh] p-4 overflow-y-auto overscroll-y-contain pb-24'>
                        {/* Fase B da experiência de corrida ativa (2026-08-03): card
                            persistente de corrida pendente. Diferente do popup (que o
                            motorista pode ignorar ou perder), este card fica na Home
                            enquanto a corrida existir como 'requested' no backend —
                            some apenas quando alguém aceita, o passageiro cancela ou
                            ela expira no servidor. Escondido se já há corrida ativa
                            (o índice único impede aceitar duas). */}
                        {!captainRide && pendingRides.length > 0 && pendingRides.map(pending => {
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
                        <CaptainDetails />
                    </div>
                </>
            )}
            <BottomSheet open={ridePopupPanel} onClose={() => setRidePopupPanel(false)} className="pb-6">
                <RidePopUp
                    ride={ride}
                    open={ridePopupPanel}
                    setRidePopupPanel={setRidePopupPanel}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel}
                    confirmRide={confirmRide}
                />
            </BottomSheet>
            <BottomSheet open={confirmRidePopupPanel} onClose={() => setConfirmRidePopupPanel(false)} className="pb-6">
                <ConfirmRidePopUp
                    ride={ride}
                    setConfirmRidePopupPanel={setConfirmRidePopupPanel} setRidePopupPanel={setRidePopupPanel} />
            </BottomSheet>
            <CaptainHeader />
        </div>
    )
}

export default CaptainHome