import React, { useState, useEffect, useContext, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import FinishRide from '@/driver/components/FinishRide'
import Button from '@/shared/components/ui/Button'
import BottomSheet from '@/shared/components/ui/BottomSheet'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'
import LiveTracking from '@/shared/components/LiveTracking'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { vehicleImages, vehicleLabels } from '@/shared/assets/vehicleAssets'
import { useToast } from '@/shared/contexts/ToastContext'
import RideChat from '@/shared/components/RideChat'
import { useWakeLock } from '@/shared/hooks/useWakeLock'
import { flushQueuedLocations } from '@/shared/services/offlineQueue'
import { joinWithRetry } from '@/shared/services/socketAuth'
import { formatManeuverDistance, maneuverIcon } from '@/shared/services/maps/navigationMath'
import { showBrowserNotification } from '@/shared/services/browserNotify'
import PassengerIdentityCard from '@/shared/components/PassengerIdentityCard'
import api from '@/shared/services/axios'
import { getAccessToken } from '@/shared/services/session'
import { buildGoogleMapsUrl } from '@/shared/utils/googleMaps'
import { formatBRL } from '@/shared/utils/currency'

const RIDE_PICKUP_STATUSES = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger']

const CaptainRiding = () => {

    const [ finishRidePanel, setFinishRidePanel ] = useState(false)
    const [ cancelPanel, setCancelPanel ] = useState(false)
    const [ detailsExpanded, setDetailsExpanded ] = useState(false)
    const [ cancelling, setCancelling ] = useState(false)
    const [ elapsedSec, setElapsedSec ] = useState(0)
    const [ liveDistance, setLiveDistance ] = useState(0)
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
    const { captainRide, setCaptainRide, syncCaptainRide } = useContext(RideContext)
    const [ rideData, setRideData ] = useState(location.state?.ride || captainRide || null)
    const [ rehydrating, setRehydrating ] = useState(!(location.state?.ride || captainRide))
    const { socket } = useContext(SocketContext)
    const navigate = useNavigate()
    const { captain } = useContext(CaptainDataContext)
    const { addToast } = useToast()
    const [ isChatOpen, setIsChatOpen ] = useState(false)
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

    useEffect(() => {
        if (!rideData || rideData.status !== 'started') return undefined
        const base = rideData.startedAt || rideData.updatedAt || rideData.createdAt
        const tick = () => {
            const startMs = base ? new Date(base).getTime() : Date.now()
            setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)))
        }
        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [rideData?._id, rideData?.status, rideData?.startedAt, rideData?.updatedAt, rideData?.createdAt])

    useEffect(() => {
        if (rideData?.actualDistance != null) {
            setLiveDistance(rideData.actualDistance)
        }
    }, [rideData?.actualDistance])

    useEffect(() => {
        if (!socket) return undefined
        const onLoc = (payload) => {
            if (payload?.rideId && rideData?._id && String(payload.rideId) !== String(rideData._id)) return
            if (typeof payload?.actualDistance === 'number') {
                setLiveDistance(payload.actualDistance)
            }
        }
        socket.on('captain-location-updated', onLoc)
        return () => socket.off('captain-location-updated', onLoc)
    }, [socket, rideData?._id])

    useEffect(() => {
        let cancelled = false

        ;(async () => {
            try {
                // Mesmo quando chegamos aqui via navigate(state), reconcilia com o backend:
                // um snapshot antigo de accepted/going_to_pickup não pode derrubar uma
                // corrida que acabou de virar started, e o RideContext ignora regressões.
                const currentRide = await syncCaptainRide()
                if (cancelled) return

                if (currentRide?.status === 'started') {
                    setRideData(currentRide)
                    setCaptainRide(currentRide)
                    return
                }

                if (currentRide) {
                    setCaptainRide(currentRide)
                    navigate(currentRide.source === 'driver_initiated' ? '/captain-presential' : '/captain-home', {
                        replace: true,
                        state: { ride: currentRide },
                    })
                    return
                }

                if (!rideData) {
                    addToast('Nenhuma corrida em andamento encontrada.', 'info')
                    navigate('/captain-home', { replace: true })
                }
            } catch {
                if (cancelled || rideData) return
                addToast('Nenhuma corrida em andamento encontrada.', 'info')
                navigate('/captain-home', { replace: true })
            } finally {
                if (!cancelled) setRehydrating(false)
            }
        })()

        return () => { cancelled = true }
        // Roda uma vez ao montar; os demais retornos/reconexões são tratados pelo RideContext.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (!captainRide?._id || captainRide.status !== 'started') return
        if (rideData?._id && String(rideData._id) !== String(captainRide._id)) return
        setRideData(captainRide)
    }, [captainRide, rideData?._id])

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
        if (!captain?._id || !rideData) return;

        const handleConnect = () => {
            // Auditoria PWA (2026-08-03, C2) + auditoria de regressão de push
            // (2026-08-03): joinWithRetry renova o token e tenta de novo se o atual já
            // estiver vencido — ver docs/plans/2026-08-03-auditoria-regressao-push.md.
            joinWithRetry(socket, { userId: captain._id, userType: 'captain' }, () => {
                flushQueuedLocations(socket).catch(e => console.error(e))
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
                ? 'Corrida presencial iniciada — GPS ativo. Destino ao finalizar.'
                : 'Corrida iniciada — navegue até o destino!',
            'info'
        )
        showBrowserNotification('Corrida Iniciada', `A caminho de ${destLabel}`)

        return () => {
            socket.off('connect', handleConnect)
        }
    }, [captain?._id, rideData?._id])  // stable deps only

    /* ── Payment / cancel socket events ── */
    useEffect(() => {
        if (!socket) return undefined

        // Auditoria do app do motorista (2026-08-11, P1): o evento já traz a corrida
        // atualizada do backend (com finalPrice correto) — usar isso em vez de
        // rideData?.fare (estado local que nunca é atualizado depois que a corrida sai
        // de 'started', então sempre mostrava a ESTIMATIVA, não o valor final cobrado).
        const handlePaymentCompleted = (data) => {
            const amount = Number(data?.finalPrice ?? data?.fare ?? rideData?.finalPrice ?? rideData?.fare ?? 0)
            const passengerName = data?.user?.fullname?.firstname || rideData?.user?.fullname?.firstname || 'passageiro'
            addToast(`Pagamento recebido! ${formatBRL(amount)}`, 'success')
            showBrowserNotification(
                'Pagamento Recebido! 💰',
                `${formatBRL(amount)} recebido de ${passengerName}`
            )
            // Fase A da experiência de corrida ativa (2026-08-03): limpa o RideContext
            // antes de voltar pra Home — sem isso, o contexto ficava com a corrida
            // 'started' obsoleta e a Home mostraria "corrida em andamento" até a
            // próxima sincronização com o backend.
            setCaptainRide(null)
            setTimeout(() => navigate('/captain-home'), 3500)
        }
        
        const handleReceiveMessage = (msg) => {
            if (!isChatOpen) {
                setUnreadCount(prev => prev + 1);
                addToast('Nova mensagem do passageiro', 'info');
                
                try {
                    const audio = new Audio('/sounds/new-ride.wav');
                    audio.play().catch(e => console.log(e));
                } catch (e) {}
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
        
        socket.on('payment-completed', handlePaymentCompleted)
        socket.on('receive-message', handleReceiveMessage)
        socket.on('ride-cancelled', handleRideCancelled)
        
        return () => {
            socket.off('payment-completed', handlePaymentCompleted)
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
                const response = await api.get(`${import.meta.env.VITE_BASE_URL}/chat/${rideData?._id}`, {
                    headers: { Authorization: `Bearer ${getAccessToken('captain')}` }
                });
                if (response.data.chat) {
                    setUnreadCount(response.data.chat.unreadCaptain || 0);
                }
            } catch (err) {}
        };
        if (rideData?._id && rideData?.user?._id) fetchUnread();
    }, [rideData])

    const vType = rideData?.vehicleType || 'car'
    const vehicleLabel = vehicleLabels[vType] || 'MoveGo'
    const vehicleImg = vehicleImages[vType] || vehicleImages.car

    // Etapa atual pra "Abrir no Google Maps": coleta enquanto o motorista ainda
    // não pegou o passageiro, destino a partir de 'started'. Usa coordenada
    // (mais precisa) e cai pro endereço em texto quando não há coordenada.
    const onPickupLeg = RIDE_PICKUP_STATUSES.includes(rideData?.status)
    const mapsTarget = onPickupLeg
        ? { lat: rideData?.pickupCoordinates?.lat, lng: rideData?.pickupCoordinates?.lng, address: rideData?.pickup }
        : { lat: rideData?.destinationCoordinates?.lat, lng: rideData?.destinationCoordinates?.lng, address: rideData?.destination }
    const mapsUrl = buildGoogleMapsUrl(mapsTarget)

    // Cancelamento de corrida presencial (2026-08-08): o backend já suportava isto
    // (rideService.cancelRideByCaptain, ramo source==='driver_initiated', permite
    // cancelar mesmo em 'started' — "engano do motorista", sem redespacho, sem
    // cobrança) e já era usado em CaptainPresentialRide.jsx (antes de iniciar) — só
    // faltava o botão aqui, na tela "em andamento". Só aparece para presencial: uma
    // corrida normal com passageiro já embarcado não deve poder ser cancelada por
    // aqui (só finalizada), regra que já era garantida no backend antes disso.
    async function handleCancelPresential() {
        if (!rideData?._id || cancelling) return
        setCancelling(true)
        try {
            await api.post(
                `${import.meta.env.VITE_BASE_URL}/rides/captain-cancel`,
                { rideId: rideData._id, reason: 'Cancelamento de corrida presencial' },
                { headers: { Authorization: `Bearer ${getAccessToken('captain')}` } }
            )
            setCaptainRide(null)
            addToast('Corrida presencial cancelada.', 'info')
            navigate('/captain-home', { replace: true })
        } catch (err) {
            addToast(err.response?.data?.message || 'Não foi possível cancelar a corrida.', 'error')
        } finally {
            setCancelling(false)
            setCancelPanel(false)
        }
    }

    if (rehydrating) {
        return (
            <div className='h-screen flex items-center justify-center bg-surface-alt'>
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600"></div>
            </div>
        )
    }

    return (
        <div className='h-screen relative overflow-hidden'>
            <ConnectionBanner />

            {/* Full-screen map — full z-index so it's interactive */}
            <div className='absolute inset-0 z-base'>
                <LiveTracking
                    ride={rideData}
                    navigationMode={navigationMode}
                    onNavigationUpdate={handleNavigationUpdate}
                />
            </div>

            {/* Toast Notifications — rendered by global ToastProvider */}

            {/* Fase D: banner da próxima manobra. Ocupa o topo inteiro em navegação
                porque é a única informação que o motorista precisa ler em movimento —
                tudo o mais fica em botões ou no painel recolhido. */}
            {navigationMode && navInfo?.step && (
                <div className='absolute top-0 left-0 right-0 z-panel px-3 pt-3 pointer-events-none'>
                    <div className='bg-ink-900 text-white rounded-panel shadow-floating px-4 py-3 flex items-center gap-4'>
                        <i className={`${maneuverIcon(navInfo.step.maneuver)} text-4xl flex-shrink-0`} aria-hidden="true"></i>
                        <div className='min-w-0'>
                            {navInfo.distanceToStepM != null && (
                                <p className='text-2xl font-bold leading-tight'>
                                    {formatManeuverDistance(navInfo.distanceToStepM)}
                                </p>
                            )}
                            <p className='text-sm text-white/80 leading-snug line-clamp-2'>
                                {navInfo.step.instruction}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Top bar */}
            <div className={`absolute left-0 right-0 z-panel flex items-start justify-between px-4 pointer-events-none ${navigationMode && navInfo?.step ? 'top-24' : 'top-0 pt-4'}`}>
                {!(navigationMode && navInfo?.step) && (
                    <img className='w-20 pointer-events-auto drop-shadow-md' src="/movecity-logo.png" alt="MoveCity" width="500" height="500" />
                )}
                <div className='flex flex-col gap-2 pointer-events-auto ml-auto'>
                    <Link
                        to='/captain-home'
                        aria-label="Voltar para a Home"
                        className='h-11 w-11 bg-surface flex items-center justify-center rounded-full shadow-raised pointer-events-auto'
                    >
                        <i className="text-lg ri-home-5-line"></i>
                    </Link>
                    <button
                        type="button"
                        onClick={() => setNavigationMode(v => !v)}
                        aria-label={navigationMode ? 'Ver rota completa' : 'Voltar à navegação'}
                        aria-pressed={navigationMode}
                        className={`h-11 w-11 flex items-center justify-center rounded-full shadow-raised pointer-events-auto ${navigationMode ? 'bg-brand-500 text-white' : 'bg-surface text-ink-900'}`}
                    >
                        <i className={`text-lg ${navigationMode ? 'ri-compass-3-fill' : 'ri-road-map-line'}`}></i>
                    </button>
                    {/* Auditoria de UX do motorista (2026-08-02, Etapa 7, §4): não existia
                        nenhum jeito de navegar até o destino nem de ligar pro passageiro —
                        só chat, e só depois de já iniciada a corrida.
                        Fase D (2026-08-03): com a navegação interna ligada e funcionando,
                        este atalho externo vira ruído — some. Continua disponível com a
                        navegação desligada e, principalmente, quando o mapa não suporta
                        câmera de navegação (sem Map ID vetorial), que é justamente o
                        caso em que o motorista precisa de um app externo. */}
                    {mapsUrl && (!navigationMode || navInfo?.supportsCamera === false) && (
                        <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={onPickupLeg ? 'Navegar até a coleta' : 'Navegar até o destino'}
                            className='h-11 w-11 bg-brand-500 text-white flex items-center justify-center rounded-full shadow-raised pointer-events-auto'
                        >
                            <i className="text-lg ri-navigation-fill"></i>
                        </a>
                    )}
                    {rideData?.user?.phone && (
                        <a
                            href={`tel:${rideData.user.phone}`}
                            aria-label="Ligar para o passageiro"
                            className='h-11 w-11 bg-surface flex items-center justify-center rounded-full shadow-raised pointer-events-auto'
                        >
                            <i className="text-lg ri-phone-fill"></i>
                        </a>
                    )}
                    {rideData?.user?._id && (
                        <button
                            type="button"
                            onClick={() => setIsChatOpen(true)}
                            aria-label="Abrir chat com o passageiro"
                            className='h-11 w-11 bg-surface flex items-center justify-center rounded-full shadow-raised relative pointer-events-auto'
                        >
                            <i className="text-lg font-medium ri-chat-3-line"></i>
                            {unreadCount > 0 && (
                                <span className='absolute -top-1 -right-1 bg-danger-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold shadow-raised'>
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                </span>
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Bottom HUD — altura pelo conteúdo por padrão; a alça expande até
                70vh (com scroll interno) pra mostrar os detalhes completos,
                sem nunca cobrir o mapa inteiro. */}
            <div className='absolute bottom-0 left-0 right-0 z-overlay'>
                <div className={`bg-surface border-t border-line rounded-t-3xl shadow-floating select-none px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[max-height] duration-300 ease-in-out ${detailsExpanded ? 'max-h-[70vh] overflow-y-auto' : 'max-h-[60vh]'}`}>
                    <button
                        type="button"
                        onClick={() => setDetailsExpanded(v => !v)}
                        aria-expanded={detailsExpanded}
                        aria-label={detailsExpanded ? 'Recolher detalhes da corrida' : 'Expandir detalhes da corrida'}
                        className="mx-auto mb-2 flex items-center justify-center w-full py-1"
                    >
                        <span className="h-1 w-10 rounded-full bg-line" aria-hidden="true" />
                    </button>

                    <div className='flex items-center justify-between gap-3 mb-2.5'>
                        <div className='min-w-0'>
                            {isPresential ? (
                                <>
                                    <p className='text-[11px] font-semibold uppercase tracking-wide text-brand-600'>
                                        Corrida presencial
                                    </p>
                                    <p className='text-sm font-semibold text-brand-700 flex items-center gap-1.5'>
                                        <span className='inline-block h-2 w-2 rounded-full bg-brand-500' aria-hidden="true" />
                                        Em andamento
                                    </p>
                                    <p className='text-xs text-ink-600 mt-1'>
                                        Tempo {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:{String(elapsedSec % 60).padStart(2, '0')}
                                        {' · '}
                                        Distância {(liveDistance / 1000).toFixed(1)} km
                                    </p>
                                </>
                            ) : navInfo?.etaMinutes != null ? (
                                <>
                                    <p className='text-xl font-bold text-ink-900 leading-tight'>
                                        {navInfo.etaMinutes} min
                                    </p>
                                    <p className='text-xs text-ink-600 font-medium truncate'>
                                        {navInfo.remainingKm != null ? `${navInfo.remainingKm.toFixed(1)} km · ` : ''}
                                        {rideData?.destination?.split(',')[0] || 'Destino'}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className='text-base font-bold text-ink-900 leading-tight truncate flex items-center gap-1'>
                                        <i className="ri-map-pin-2-fill text-danger-500 text-sm flex-shrink-0"></i>
                                        {rideData?.destination?.split(',')[0] || 'Destino'}
                                    </p>
                                    <p className='text-xs text-ink-600 font-medium'>
                                        {rideData?.user?.fullname?.firstname || 'Passageiro'}
                                        {rideData?.fare ? ` · ${formatBRL(rideData.fare)}` : ''}
                                    </p>
                                </>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => setFinishRidePanel(true)}
                            className='flex-shrink-0 bg-brand-500 hover:bg-brand-600 text-white font-bold py-3 px-5 rounded-panel text-sm shadow-floating active:scale-95 transition-all whitespace-nowrap'
                        >
                            <i className="ri-flag-fill mr-1"></i>
                            {isPresential ? 'Finalizar corrida' : 'Concluir'}
                        </button>
                    </div>

                    {rideData?.user ? (
                        <PassengerIdentityCard user={rideData.user} showPhoto compact className="mb-2" />
                    ) : isPresential ? (
                        <p className='text-xs text-ink-600 mb-2'>Passageiro presencial (sem conta vinculada)</p>
                    ) : null}

                    <div className='flex items-center gap-2.5 min-w-0'>
                        <img
                            src={vehicleImg}
                            alt={vehicleLabel}
                            className='h-10 w-14 object-contain flex-shrink-0'
                            width="1024"
                            height="1024"
                            loading="lazy"
                        />
                        <div className='min-w-0 flex-1'>
                            <p className='text-xs text-ink-900 font-medium truncate flex items-center gap-1'>
                                <i className="ri-map-pin-2-fill text-danger-500 text-xs flex-shrink-0" aria-hidden="true"></i>
                                {rideData?.destinationPending
                                    ? 'Destino ao finalizar'
                                    : (rideData?.destination?.split(',')[0] || 'Destino')}
                            </p>
                            <p className='text-xs text-ink-600 font-medium'>
                                {rideData?.destinationPending
                                    ? 'Preço ao finalizar'
                                    : (rideData?.fare ? formatBRL(rideData.fare) : '')}
                            </p>
                        </div>
                    </div>

                    {detailsExpanded && (
                        <div className='mt-3 pt-3 border-t border-line space-y-2.5'>
                            <div className='flex items-start gap-2'>
                                <i className="ri-map-pin-user-fill text-brand-500 text-sm mt-0.5 flex-shrink-0" aria-hidden="true"></i>
                                <div className='min-w-0'>
                                    <p className='text-[10px] text-ink-400 uppercase tracking-wide'>Coleta</p>
                                    <p className='text-xs text-ink-900'>{rideData?.pickup || '—'}</p>
                                </div>
                            </div>
                            <div className='flex items-start gap-2'>
                                <i className="ri-map-pin-2-fill text-danger-500 text-sm mt-0.5 flex-shrink-0" aria-hidden="true"></i>
                                <div className='min-w-0'>
                                    <p className='text-[10px] text-ink-400 uppercase tracking-wide'>Destino</p>
                                    <p className='text-xs text-ink-900'>
                                        {rideData?.destinationPending ? 'Definido ao finalizar' : (rideData?.destination || '—')}
                                    </p>
                                </div>
                            </div>
                            <div className='grid grid-cols-2 gap-2 text-xs'>
                                <div>
                                    <p className='text-[10px] text-ink-400 uppercase tracking-wide'>Veículo</p>
                                    <p className='text-ink-900 font-medium'>{vehicleLabel}</p>
                                </div>
                                <div>
                                    <p className='text-[10px] text-ink-400 uppercase tracking-wide'>Pagamento</p>
                                    <p className='text-ink-900 font-medium capitalize'>{rideData?.paymentMethod || '—'}</p>
                                </div>
                                {rideData?.actualDistance != null && (
                                    <div>
                                        <p className='text-[10px] text-ink-400 uppercase tracking-wide'>Distância</p>
                                        <p className='text-ink-900 font-medium'>{(rideData.actualDistance / 1000).toFixed(1)} km</p>
                                    </div>
                                )}
                                {rideData?.fare != null && (
                                    <div>
                                        <p className='text-[10px] text-ink-400 uppercase tracking-wide'>Valor</p>
                                        <p className='text-ink-900 font-medium'>{formatBRL(rideData.fare)}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {isPresential && (
                        <button
                            type="button"
                            onClick={() => setCancelPanel(true)}
                            className='mt-2.5 w-full text-center text-xs font-semibold text-danger-600 py-1'
                        >
                            Cancelar corrida
                        </button>
                    )}
                </div>
            </div>

            <BottomSheet open={cancelPanel} onClose={() => setCancelPanel(false)}>
                <div className="pb-1">
                    <h3 className="text-base font-semibold mb-2 text-ink-900">Cancelar corrida presencial?</h3>
                    <p className="text-sm text-ink-600 mb-4">
                        A corrida será encerrada sem cobrança. Use isso só em caso de engano —
                        se o serviço já foi feito, use "Finalizar corrida" em vez de cancelar.
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            fullWidth={false}
                            className="flex-1 !min-h-[44px] !text-sm"
                            onClick={() => setCancelPanel(false)}
                            disabled={cancelling}
                        >
                            Voltar
                        </Button>
                        <Button
                            variant="danger"
                            fullWidth={false}
                            className="flex-1 !min-h-[44px] !text-sm"
                            onClick={handleCancelPresential}
                            loading={cancelling}
                        >
                            Sim, cancelar
                        </Button>
                    </div>
                </div>
            </BottomSheet>

            <BottomSheet open={finishRidePanel} onClose={() => setFinishRidePanel(false)}>
                <FinishRide
                    ride={rideData}
                    setFinishRidePanel={setFinishRidePanel}
                />
            </BottomSheet>

            <RideChat
                ride={rideData} 
                isOpen={isChatOpen} 
                onClose={() => setIsChatOpen(false)} 
                currentUserType="captain" 
            />
        </div>
    )
}

export default CaptainRiding
