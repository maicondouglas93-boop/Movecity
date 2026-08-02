import React, { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
import axios from 'axios'
import LiveTracking from '@/shared/components/LiveTracking'
import { useToast } from '@/contexts/ToastContext'
import CaptainHeader from '@/modules/driver/components/CaptainHeader'
import { requestFCMToken } from '@/services/fcm'
import { useWakeLock } from '@/shared/hooks/useWakeLock'
import { db } from '@/services/db'
import { enqueueOfflineAction } from '@/services/offlineQueue'
import * as Sentry from '@sentry/react'

const CaptainHome = () => {

    const [ ridePopupPanel, setRidePopupPanel ] = useState(false)
    const [ confirmRidePopupPanel, setConfirmRidePopupPanel ] = useState(false)

    const [ ride, setRide ] = useState(null)

    const { socket } = useContext(SocketContext)
    const { captain, setCaptain } = useContext(CaptainDataContext)
    const { locationRef, locationError } = useContext(LocationContext)
    const { addToast } = useToast()
    const [ refreshingApproval, setRefreshingApproval ] = useState(false)

    // Auditoria de UX do motorista (2026-08-02, §2.7): busca o perfil de novo sob
    // demanda (botão "Verificar novamente" do ApprovalGate) — o contexto só é
    // atualizado no login/refresh de página, então um motorista aprovado enquanto o
    // app estava aberto continuaria vendo a tela de bloqueio até fechar e reabrir.
    const refreshApprovalStatus = async () => {
        setRefreshingApproval(true)
        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/captains/profile`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('captain-token')}` }
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

    useEffect(() => {
        const setupFCM = async () => {
            if ('Notification' in window && Notification.permission === 'granted') {
                await requestFCMToken();
            }
        };
        setupFCM();
    }, [])

    const { requestLock } = useWakeLock();
    useEffect(() => {
        requestLock();
    }, [requestLock]);

    // Ref para acessar o ride atual dentro de handlers sem precisar re-subscrever
    const rideRef = useRef(ride)
    useEffect(() => { rideRef.current = ride }, [ride])

    // --- Efeito 1: conexão e listeners do socket (só depende do captain) ---
    useEffect(() => {
        if (!captain || !captain._id) return;

        const handleConnect = () => {
            socket.emit('join', {
                userId: captain._id,
                userType: 'captain'
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
                new Notification('Nova Solicitação de Corrida! 🚗', {
                    body: `${data.pickup?.split(',')[0]} → ${data.destination?.split(',')[0]} • R$${data.fare}`,
                    icon: '/movecity-icon.jpg'
                })
                console.log(`[AUDIT][${TRACE_ID}] Web Push Nativo (Browser) exibido.`);
            } else {
                console.log(`[AUDIT][${TRACE_ID}] Web Push não exibido (Sem permissão ou API inexistente). Permissão atual:`, Notification.permission);
            }
        }

        const handleRideCancelled = (data) => {
            if (rideRef.current && rideRef.current._id === data.rideId) {
                setRidePopupPanel(false)
                setRide(null)
                addToast('A corrida foi cancelada pelo passageiro.', 'info')
            }
        }

        // P3.1 da auditoria de concorrência (2026-08-02): emitido desde sempre pelo
        // backend quando outro motorista aceita a corrida primeiro (ride.controller.js),
        // mas nenhum frontend escutava — o motorista que perdeu a corrida ficava com o
        // popup aberto até tocar em algo, sem saber que ela já tinha sido pega.
        const handleRideTaken = (data) => {
            if (rideRef.current && rideRef.current._id === data.rideId) {
                setRidePopupPanel(false)
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


    async function confirmRide() {
        try {
            // Endpoint atômico (P1.3 da auditoria de concorrência, 2026-08-01) — antes
            // usava /rides/confirm, que sobrescrevia sem checar status: dois motoristas
            // aceitando a mesma corrida ao mesmo tempo recebiam 200 os dois.
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/${ride._id}/accept`, {}, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('captain-token')}`
                }
            })

            if (response.data) {
                setRide(response.data)
            }
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
                setRidePopupPanel(false)
                setConfirmRidePopupPanel(false)
                setRide(null)
            } else if (!navigator.onLine || err.code === 'ERR_NETWORK') {
                enqueueOfflineAction({
                    type: 'accept-ride',
                    rideId: ride._id,
                    payload: { rideId: ride._id }
                }).catch(e => console.error(e));

                // Optimistic UI updates
                const optimisticRide = { ...ride, status: 'accepted', captain };
                setRide(optimisticRide);
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

            {needsApprovalGate ? (
                <div className='flex-1 overflow-y-auto pb-20'>
                    <ApprovalGate captain={captain} onRefresh={refreshApprovalStatus} refreshing={refreshingApproval} />
                </div>
            ) : (
                <>
                    <div className='h-[40vh] relative shadow-raised z-panel'>
                        <LiveTracking ride={ride} showSearchRadius={true} />
                    </div>
                    <div className='h-[60vh] p-4 overflow-y-auto pb-24'>
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