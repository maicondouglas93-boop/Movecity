import { useState, useEffect, useContext, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import FinishRide from '@/driver/components/FinishRide'
import Button from '@/shared/components/ui/Button'
import DriverOperationalDialog from '@/driver/components/DriverOperationalDialog'
import DriverTripView from '@/driver/components/DriverTripView'
import ActiveRideHelp from '@/driver/components/ActiveRideHelp'
import { activeRidePresentation } from '@/driver/services/activeRidePresentation'
import { LocationRefContext } from '@/shared/contexts/LocationContext'
import useConnectionState from '@/shared/hooks/useConnectionState'
import { openDriverAppSettings } from '@/shared/platform/driverPermissions.service'
import { isNativePlatform } from '@/shared/platform/platform'
import LiveTracking from '@/shared/components/LiveTracking'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { useToast } from '@/shared/contexts/ToastContext'
import RideChat from '@/shared/components/RideChat'
import { useWakeLock } from '@/shared/hooks/useWakeLock'
import { flushQueuedLocations, replayOfflineActions, hasPendingFinalization } from '@/shared/services/offlineQueue'
import { joinWithRetry } from '@/shared/services/socketAuth'
import { showBrowserNotification } from '@/shared/services/browserNotify'
import api from '@/shared/services/axios'
import { getAccessToken } from '@/shared/services/session'
import { buildGoogleMapsUrl } from '@/shared/utils/googleMaps'
import { withHardTimeout } from '@/shared/utils/hardTimeout'
import { useRideMeter } from '@/shared/hooks/useRideMeter'
import { hasRideId, isStartedRide } from '@/shared/utils/rideIdentity'

const RIDE_PICKUP_STATUSES = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger']

// Espelha PRESENTIAL_CANCEL_WINDOW_MS do backend (ride.service.js). Se mudar lá,
// mudar aqui: o servidor é quem decide, isto só evita mostrar um botão que vai falhar.
const PRESENTIAL_CANCEL_WINDOW_SEC = 60

const CaptainRiding = () => {

    const [activePanel, setActivePanel] = useState(null)
    const finishRidePanel = activePanel === 'finish'
    const cancelPanel = activePanel === 'cancel'
    const isChatOpen = activePanel === 'chat'
    const [detailsExpanded, setDetailsExpanded] = useState(false)
    const [finishBusy, setFinishBusy] = useState(false)
    const [finishCompleted, setFinishCompleted] = useState(false)
    const finishCompletedRef = useRef(false)
    finishCompletedRef.current = finishCompleted
    const [meterRetry, setMeterRetry] = useState(0)
    const setFinishRidePanel = useCallback(open => setActivePanel(panel => open ? 'finish' : panel === 'finish' ? null : panel), [])
    const setCancelPanel = useCallback(open => setActivePanel(panel => open ? 'cancel' : panel === 'cancel' ? null : panel), [])
    const setIsChatOpen = useCallback(open => setActivePanel(panel => open ? 'chat' : panel === 'chat' ? null : panel), [])
    const connection = useConnectionState()
    const { locationRef, locationError } = useContext(LocationRefContext) || {}
    const [ cancelling, setCancelling ] = useState(false)
    const [ elapsedSec, setElapsedSec ] = useState(0)
    const location = useLocation()
    // Auditoria de UX do motorista (2026-08-02, §2.6): rideData vivia só em
    // location.state, que não sobrevive a um refresh de página nem ao app sendo
    // derrubado em segundo plano — nesses casos o motorista ficava no meio de uma
    // corrida (com o passageiro no carro) e a tela perdia tudo: passageiro, destino,
    // valor, mapa vazio. Agora começa com o state (otimização — resposta imediata) e,
    // se ele vier vazio, busca a corrida ativa de verdade no servidor.
    // Fase A da experiência de corrida ativa (2026-08-03): o RideContext pode já ter a
    // corrida restaurada (ele consulta /rides/captain-current a cada abertura/retorno) —
    // usa como segunda fonte imediata antes de cair no fetch próprio abaixo.
    const { captainRide, captainRideReconciled, setCaptainRide, syncCaptainRide } = useContext(RideContext)
    const [ rideData, setRideData ] = useState(location.state?.ride || captainRide || null)
    const [ rehydrating, setRehydrating ] = useState(true)
    const [ recoveryAttempt, setRecoveryAttempt ] = useState(0)
    const { socket } = useContext(SocketContext)
    const meter = useRideMeter(!rehydrating && !finishCompleted && isStartedRide(rideData) ? rideData : null, socket, meterRetry)
    const navigate = useNavigate()
    const { captain } = useContext(CaptainDataContext)
    const { addToast } = useToast()
    const [ unreadCount, setUnreadCount ] = useState(0)

    // Fase D da experiência de corrida ativa (2026-08-03): navegação estilo Waze.
    // Começa ligada — o motorista chegou aqui justamente para dirigir. Sem destino
    // definido (presencial pending) não há manobra pra mostrar no banner, mas a
    // câmera ainda segue o motorista normalmente (LiveTracking não exige rota pra
    // rodar o loop de câmera) — por isso começa ativada mesmo nesse caso (pedido
    // explícito: o botão de navegação deve começar ativado numa corrida presencial
    // iniciada pelo GO).
    // Painel inferior sempre aberto com as infos essenciais (sem expandir/recolher).
    const [ navigationMode, setNavigationMode ] = useState(true)
    const [ navInfo, setNavInfo ] = useState(null)

    const handleNavigationUpdate = useCallback((info) => setNavInfo(info), [])

    const isPresential = rideData?.source === 'driver_initiated'

    // Cancelar uma presencial já iniciada só faz sentido logo no começo (engano,
    // passageiro desistiu na hora). Depois disso o botão sai da tela: sem o limite, dava
    // pra rodar a viagem inteira e cancelar no fim, fugindo da comissão. O servidor
    // aplica a MESMA regra (PRESENTIAL_CANCEL_WINDOW_MS em ride.service.js) — aqui é só
    // a camada visual, que sozinha não protegeria nada.
    const startedMs = new Date(rideData?.startedAt).getTime()
    const canCancelPresential = isPresential && Number.isFinite(startedMs)
        && Date.now() >= startedMs && Date.now() - startedMs <= PRESENTIAL_CANCEL_WINDOW_SEC * 1000
    const cancelRequestRef = useRef(false)
    const currentTripRef = useRef(null)
    currentTripRef.current = { rideId: rideData?._id, captainId: captain?._id }
    useEffect(() => () => { currentTripRef.current = null }, [])

    useEffect(() => {
        if (rehydrating || finishCompleted || !isStartedRide(rideData)) return undefined
        const base = rideData.startedAt || rideData.updatedAt || rideData.createdAt
        const tick = () => {
            const startMs = base ? new Date(base).getTime() : Date.now()
            setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)))
        }
        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [rehydrating, finishCompleted, rideData?._id, rideData?.status, rideData?.startedAt, rideData?.updatedAt, rideData?.createdAt])

    useEffect(() => {
        let cancelled = false
        let pendingChecked = false
        setRehydrating(true)

        ;(async () => {
            try {
                // O state do navegador pode conter uma corrida anterior ao toque offline.
                // Não religar o taxímetro nem os controles a partir desse snapshot.
                if (await withHardTimeout(hasPendingFinalization(rideData?._id, { throwOnError: true }), 5000)) {
                    if (!cancelled) navigate('/captain/rides', { replace: true })
                    return
                }
                pendingChecked = true
                if (cancelled) return
                // Corrida local válida não espera a rede para voltar a contar.
                if (isStartedRide(rideData)) setRehydrating(false)
                // Mesmo quando chegamos aqui via navigate(state), reconcilia com o backend:
                // um snapshot antigo de accepted/going_to_pickup não pode derrubar uma
                // corrida que acabou de virar started, e o RideContext ignora regressões.
                const currentRide = await withHardTimeout(syncCaptainRide(), 15000)
                if (cancelled || finishCompletedRef.current) return

                if (isStartedRide(currentRide)) {
                    pendingChecked = false
                    if (await withHardTimeout(hasPendingFinalization(currentRide._id, { throwOnError: true }), 5000)) {
                        if (!cancelled) navigate('/captain/rides', { replace: true })
                        return
                    }
                    pendingChecked = true
                    if (cancelled) return
                    setRideData(currentRide)
                    setCaptainRide(currentRide)
                    return
                }

                if (hasRideId(currentRide?._id) && currentRide.status !== 'started') {
                    setCaptainRide(currentRide)
                    navigate(currentRide.source === 'driver_initiated' ? '/captain-presential' : '/captain-home', {
                        replace: true,
                        state: { ride: currentRide },
                    })
                    return
                }

                if (currentRide === null) {
                    addToast('Nenhuma corrida em andamento encontrada.', 'info')
                    navigate('/captain-home', { replace: true })
                }
            } catch {
                if (cancelled) return
                if (!pendingChecked) {
                    addToast('Não foi possível verificar a finalização salva. Consulte a tela Corridas.', 'warning')
                    navigate('/captain/rides', { replace: true })
                    return
                }
                // Falha de rede não confirma ausência de corrida. Sem snapshot válido,
                // exibe recuperação com nova tentativa, nunca controles vazios.
            } finally {
                if (!cancelled && pendingChecked) setRehydrating(false)
            }
        })()

        return () => { cancelled = true }
        // Montagem e nova tentativa explícita; reconexões também chegam pelo contexto.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recoveryAttempt])

    useEffect(() => {
        if (!isStartedRide(captainRide)) return
        if (rideData?._id && String(rideData._id) !== String(captainRide._id)) return
        let cancelled = false
        withHardTimeout(hasPendingFinalization(captainRide._id, { throwOnError: true }), 5000)
            .then(pending => {
                if (cancelled) return
                if (pending) navigate('/captain/rides', { replace: true })
                else {
                    setRideData(captainRide)
                    setRehydrating(false)
                }
            }).catch(() => {
                if (!cancelled) navigate('/captain/rides', { replace: true })
            })
        return () => { cancelled = true }
    }, [captainRide, rideData?._id, navigate])

    useEffect(() => {
        // 404 confirmado após reconexão é diferente de falha de rede (UNKNOWN).
        // Não manter uma corrida fantasma no estado interno da tela.
        if (!finishCompleted && captainRideReconciled && captainRide === null) navigate('/captain-home', { replace: true })
    }, [finishCompleted, captainRideReconciled, captainRide, navigate])

    const { requestLock } = useWakeLock();
    useEffect(() => {
        requestLock();
    }, [requestLock]);

    /* ── Join do socket + aviso de início da corrida ──
     * O envio periódico de GPS vive só em CaptainLocationBridge (montado em
     * DriverAppProviders, 5s com serviço ativo). Auditoria de integração
     * (2026-08-06): esta tela mantinha um segundo setInterval de 5s emitindo o
     * mesmo `update-location-captain`, dobrando a taxa de amostragem. Como o
     * backend soma qualquer deslocamento acima de 5m em `actualDistance`, o
     * ruído de GPS parado no trânsito era contado duas vezes e inflava a
     * tarifa final recalculada em endRide. A Bridge já cobre o enfileiramento
     * offline em IndexedDB, então o bloco inteiro era redundante.
     */
    useEffect(() => {
        if (rehydrating || !captain?._id || !isStartedRide(rideData)) return;

        const handleConnect = () => {
            // Auditoria PWA (2026-08-03, C2) + auditoria de regressão de push
            // (2026-08-03): joinWithRetry renova o token e tenta de novo se o atual já
            // estiver vencido — ver docs/plans/2026-08-03-auditoria-regressao-push.md.
            joinWithRetry(socket, { userId: captain._id, userType: 'captain' }, () => {
                flushQueuedLocations(socket)
                    .catch((e) => console.error(e))
                    .finally(() => {
                        replayOfflineActions({ socket }).catch((e) => console.error(e))
                    })
            })
        }

        if (socket.connected) {
            handleConnect()
        }

        socket.on('connect', handleConnect)

        const destLabel = rideData?.destinationPending
            ? 'destino a definir ao finalizar'
            : (rideData?.destination?.split(',')[0] || 'destino')
        addToast(
            rideData?.destinationPending
                ? 'Corrida presencial em andamento. Confira o sinal de GPS; destino ao finalizar.'
                : 'Corrida iniciada — navegue até o destino!',
            'info'
        )
        showBrowserNotification('Corrida Iniciada', `A caminho de ${destLabel}`)

        return () => {
            socket.off('connect', handleConnect)
        }
    }, [rehydrating, captain?._id, rideData?._id, rideData?.status])  // stable deps only

    /* ── Payment / cancel socket events ── */
    useEffect(() => {
        if (!socket) return undefined

        const handlePaymentReported = (data) => {
            if (rideData?._id && data?.rideId && String(data.rideId) !== String(rideData._id)) return
            addToast('O passageiro informou que pagou. Confirme somente após receber o valor.', 'info', 7000)
            showBrowserNotification(
                'Passageiro informou pagamento',
                'Confira o recebimento e confirme no app.'
            )
        }
        
        const handleReceiveMessage = () => {
            if (!isChatOpen) {
                setUnreadCount(prev => prev + 1);
                addToast('Nova mensagem do passageiro', 'info');
                
                try {
                    const audio = new Audio('/sounds/new-ride.wav');
                    audio.play().catch(e => console.log(e));
                } catch { /* O som é opcional; o aviso visual permanece. */ }
            }
        }

        const handleRideCancelled = (data) => {
            if (rideData?._id && data?.rideId && String(data.rideId) !== String(rideData._id)) return
            setCaptainRide(null)
            setRideData(null)
            const byAdmin = data?.cancelledBy === 'admin'
            addToast(
                byAdmin
                    ? 'Corrida cancelada pelo administrador.'
                    : 'A corrida foi cancelada pelo passageiro.',
                'info',
            )
            showBrowserNotification(
                'Corrida cancelada',
                byAdmin
                    ? 'Cancelada pelo administrador.'
                    : 'O passageiro cancelou a corrida.',
            )
            navigate('/captain-home', { replace: true })
        }
        
        socket.on('payment-reported', handlePaymentReported)
        socket.on('receive-message', handleReceiveMessage)
        socket.on('ride-cancelled', handleRideCancelled)
        
        return () => {
            socket.off('payment-reported', handlePaymentReported)
            socket.off('receive-message', handleReceiveMessage)
            socket.off('ride-cancelled', handleRideCancelled)
        }
    }, [socket, navigate, rideData, addToast, isChatOpen, setCaptainRide])
    
    // Reset unread count when chat opens
    useEffect(() => {
        if (isChatOpen) setUnreadCount(0);
    }, [isChatOpen])
    
    // Fetch initial unread count
    useEffect(() => {
        const fetchUnread = async () => {
            try {
                const response = await withHardTimeout(
                    api.get(`${import.meta.env.VITE_BASE_URL}/chat/${rideData?._id}`, {
                        headers: { Authorization: `Bearer ${getAccessToken('captain')}` }
                    })
                );
                if (response.data.chat) {
                    setUnreadCount(response.data.chat.unreadCaptain || 0);
                }
            } catch { /* Falha de contagem não impede a viagem ou a abertura do chat. */ }
        };
        if (rideData?._id && rideData?.user?._id) fetchUnread();
    }, [rideData])

    const presentation = activeRidePresentation({ ride: rideData, meter, ...connection,
        location: locationRef?.current, locationError })
    const reviewGps = () => {
        if (isNativePlatform()) openDriverAppSettings()
        else addToast('Confira a permissão de localização deste site e o GPS do aparelho. Não é necessário sair da conta.', 'info')
    }
    const closeFinish = () => {
        if (finishBusy) return
        if (finishCompleted) navigate('/captain/rides', { replace: true })
        else setFinishRidePanel(false)
    }

    // Etapa atual pra "Abrir no Google Maps": coleta enquanto o motorista ainda
    // não pegou o passageiro, destino a partir de 'started'. Usa coordenada
    // (mais precisa) e cai pro endereço em texto quando não há coordenada.
    const onPickupLeg = RIDE_PICKUP_STATUSES.includes(rideData?.status)
    const mapsTarget = onPickupLeg
        ? { lat: rideData?.pickupCoordinates?.lat, lng: rideData?.pickupCoordinates?.lng, address: rideData?.pickup }
        : { lat: rideData?.destinationCoordinates?.lat, lng: rideData?.destinationCoordinates?.lng, address: rideData?.destination }
    const mapsUrl = rideData?.destinationPending ? null : buildGoogleMapsUrl(mapsTarget)

    // Cancelamento de corrida presencial (2026-08-08): o backend já suportava isto
    // (rideService.cancelRideByCaptain, ramo source==='driver_initiated', permite
    // cancelar mesmo em 'started' — "engano do motorista", sem redespacho, sem
    // cobrança) e já era usado em CaptainPresentialRide.jsx (antes de iniciar) — só
    // faltava o botão aqui, na tela "em andamento". Só aparece para presencial: uma
    // corrida normal com passageiro já embarcado não deve poder ser cancelada por
    // aqui (só finalizada), regra que já era garantida no backend antes disso.
    async function handleCancelPresential() {
        if (!rideData?._id || cancelRequestRef.current || finishCompleted || !canCancelPresential) return
        cancelRequestRef.current = true
        const target = currentTripRef.current
        const isCurrent = () => currentTripRef.current?.rideId === target.rideId
            && currentTripRef.current?.captainId === target.captainId
        setCancelling(true)
        try {
            await withHardTimeout(
                api.post(
                    `${import.meta.env.VITE_BASE_URL}/rides/captain-cancel`,
                    { rideId: rideData._id, reason: 'Cancelamento de corrida presencial' },
                    { headers: { Authorization: `Bearer ${getAccessToken('captain')}` } }
                )
            )
            if (!isCurrent()) return
            setCaptainRide(null)
            addToast('Corrida presencial cancelada.', 'info')
            navigate('/captain-home', { replace: true })
        } catch (err) {
            if (!isCurrent()) return
            addToast(err.response?.data?.message || 'Não foi possível cancelar a corrida.', 'error')
        } finally {
            cancelRequestRef.current = false
            if (isCurrent()) { setCancelling(false); setCancelPanel(false) }
        }
    }

    if (rehydrating) {
        return (
            <div className='h-screen flex items-center justify-center bg-surface-alt'>
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600"></div>
            </div>
        )
    }

    if (!isStartedRide(rideData)) {
        return (
            <div className="h-screen flex flex-col items-center justify-center gap-4 p-6 bg-surface-alt text-center">
                <h1 className="text-lg font-semibold">Não foi possível recuperar a corrida</h1>
                <p role="status">Os dados da viagem ainda não estão disponíveis. Tente novamente ou consulte as finalizações pendentes em Corridas.</p>
                <Button onClick={() => setRecoveryAttempt(attempt => attempt + 1)}>Tentar novamente</Button>
                <Button variant="secondary" onClick={() => navigate('/captain/rides', { replace: true })}>Abrir Corridas</Button>
            </div>
        )
    }

    return (
        <>
            <DriverTripView ride={rideData} presentation={presentation} elapsedSec={elapsedSec}
                expanded={detailsExpanded} onExpand={() => setDetailsExpanded(value => !value)}
                onFinish={() => setFinishRidePanel(true)} onHelp={() => setActivePanel('help')}
                onCancel={() => setCancelPanel(true)} canCancel={canCancelPresential && !finishCompleted}
                onChat={() => setIsChatOpen(true)} unreadCount={unreadCount}
                onReviewGps={reviewGps} onRetryMeter={() => setMeterRetry(value => value + 1)}
                navigationMode={navigationMode} onNavigationToggle={() => setNavigationMode(value => !value)}
                navInfo={navInfo} mapsUrl={mapsUrl} modalOpen={Boolean(activePanel)}>
                <LiveTracking ride={rideData} navigationMode={navigationMode}
                    onNavigationUpdate={handleNavigationUpdate} bottomInsetPx={0} observeViewport />
            </DriverTripView>
            <DriverOperationalDialog open={cancelPanel} title="Cancelar corrida presencial?"
                busy={cancelling} onClose={() => setCancelPanel(false)} closeLabel="Voltar à corrida">
                <p className="text-sm text-ink-700 mb-4">
                    Cancelamento por engano só é permitido no primeiro minuto. O servidor verifica o prazo.
                    Ao ser confirmado, encerra a corrida sem cobrança. Depois desse prazo, use a finalização ou peça ajuda.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" fullWidth={false} onClick={() => setCancelPanel(false)} disabled={cancelling}>Voltar</Button>
                    <Button variant="danger" fullWidth={false} onClick={handleCancelPresential} loading={cancelling}
                        disabled={!canCancelPresential}>Sim, cancelar</Button>
                </div>
            </DriverOperationalDialog>
            <DriverOperationalDialog open={finishRidePanel} title="Finalização da corrida"
                busy={finishBusy} onClose={closeFinish} closeLabel={finishCompleted ? 'Abrir histórico de corridas' : 'Voltar à corrida'}>
                <FinishRide ride={{ ...rideData, actualDistance: meter?.serverDistance ?? rideData?.actualDistance }}
                    setFinishRidePanel={setFinishRidePanel} onBusyChange={setFinishBusy} onFinishedChange={setFinishCompleted} />
            </DriverOperationalDialog>
            <DriverOperationalDialog open={activePanel === 'help'} title="Ajuda e segurança"
                onClose={() => setActivePanel(null)} closeLabel="Voltar à corrida">
                <ActiveRideHelp ride={rideData} presentation={presentation} onClose={() => setActivePanel(null)} />
            </DriverOperationalDialog>
            <DriverOperationalDialog open={isChatOpen} title="Chat com o passageiro"
                onClose={() => setIsChatOpen(false)} closeLabel="Voltar à corrida">
                <RideChat ride={rideData} isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} currentUserType="captain" embedded />
            </DriverOperationalDialog>
        </>
    )
}

export default CaptainRiding
