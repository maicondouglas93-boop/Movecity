import { useState, useEffect, useContext, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import { enqueueOfflineAction } from '@/shared/services/offlineQueue'
import { withHardTimeout } from '@/shared/utils/hardTimeout'
import * as Sentry from '@sentry/react'
import Button from '@/shared/components/ui/Button'
import PassengerIdentityCard from '@/shared/components/PassengerIdentityCard'
import { useToast } from '@/shared/contexts/ToastContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { formatBRL } from '@/shared/utils/currency'
import { paymentMethodLabel } from '@/shared/utils/ridePaymentPresentation'
import { buildGoogleMapsUrl } from '@/shared/utils/googleMaps'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { isRideAssignedToCaptain, isRideConnectivityError, PICKUP_STATES } from '@/shared/utils/driverRideState'

// Fase A da experiência de corrida ativa (2026-08-03): o status dos botões vem da
// corrida real (backend), não mais de um useState fixo em 'accepted' — depois de um
// refresh, os botões voltavam pra "A caminho" mesmo com o motorista já no local.
// 'waiting_passenger' mostra a mesma ação de início de 'arrived'.
const deriveStatusFromRide = (status) => {
    if (status === 'waiting_passenger') return 'arrived'
    if ([ 'accepted', 'going_to_pickup', 'arrived' ].includes(status)) return status
    return 'accepted'
}

// Implementação do sistema de cancelamento (2026-08-04): o backend exige motivo
// (Backend/services/ride.service.js: CAPTAIN_CANCEL_REQUIRES_REASON) quando o
// motorista já chegou/está esperando o passageiro — cancelar sem dizer por quê nesse
// ponto deixa o passageiro sem nenhuma explicação de por que o motorista sumiu.
const CANCEL_REASONS = [
    'Passageiro não apareceu',
    'Não consegui localizar o passageiro',
    'Problema com o veículo',
    'Situação de segurança',
    'Outro',
]

const ConfirmRidePopUp = (props) => {
    const [loading, setLoading] = useState(false)
    const [savingOffline, setSavingOffline] = useState(false)
    const actionRef = useRef(false)
    const mountedRef = useRef(true)
    const [rideStatus, setRideStatus] = useState(deriveStatusFromRide(props.ride?.status))
    const [cancelling, setCancelling] = useState(false)
    const [showCancelModal, setShowCancelModal] = useState(false)
    const [selectedReason, setSelectedReason] = useState('')
    const [customReason, setCustomReason] = useState('')
    const onBusyChange = props.onBusyChange
    useEffect(() => {
        onBusyChange?.(loading || cancelling)
        return () => onBusyChange?.(false)
    }, [loading, cancelling, onBusyChange])
    const navigate = useNavigate()
    const { addToast } = useToast()
    const { setCaptainRide } = useContext(RideContext)
    const { captain } = useContext(CaptainDataContext)
    const currentRef = useRef(null)
    currentRef.current = { ride: props.ride, captainId: captain?._id }
    const validPickup = isRideAssignedToCaptain(props.ride, captain?._id)
        && PICKUP_STATES.includes(props.ride.status)
    useEffect(() => {
        mountedRef.current = true
        return () => { mountedRef.current = false }
    }, [])

    // Motivo só é obrigatório com o motorista já chegado/esperando — antes disso é
    // só solicitado (fica registrado se o motorista informar, mas não bloqueia).
    const reasonRequired = rideStatus === 'arrived'
    const resolvedReason = selectedReason === 'Outro' ? customReason.trim() : selectedReason
    const canConfirmCancel = !reasonRequired || resolvedReason.length > 0

    // O componente fica sempre montado dentro do BottomSheet — quando a corrida chega
    // (aceite ou restauração pós-refresh), sincroniza os botões com o status real.
    useEffect(() => {
        if (props.ride?._id) {
            setRideStatus(deriveStatusFromRide(props.ride.status))
        }
    }, [props.ride?._id, props.ride?.status])

    // Auditoria de UX do motorista (2026-08-02, §2.4): antes este botão só fechava os
    // painéis — a corrida continuava atribuída a este motorista no banco, travando-o
    // (pelo índice único de corrida ativa) sem que ele soubesse o motivo. Agora chama o
    // endpoint atômico que devolve a corrida ao despacho pra outro motorista aceitar.
    const cancelRide = async () => {
        if (!canConfirmCancel || !validPickup || actionRef.current) return
        actionRef.current = true
        const targetId = props.ride._id
        const ownerId = captain._id
        const isCurrent = () => mountedRef.current && currentRef.current.ride?._id === targetId
            && currentRef.current.captainId === ownerId
        setCancelling(true)
        try {
            // Via api (@/shared/services/axios): token do motorista + refresh automático em
            // 401. Antes usava axios cru com header manual — access token de 15 min
            // vencido gerava 401 sem renovação (botões "A caminho"/"Cheguei" mortos).
            await withHardTimeout(
                api.post('/rides/captain-cancel', { rideId: targetId, reason: resolvedReason || undefined })
            )
            if (!isCurrent()) return
            addToast('Corrida liberada — buscando outro motorista para o passageiro.', 'info')
            // Limpa a corrida no RideContext na hora — sem isso, o efeito de restauração
            // do CaptainHome ainda veria a corrida antiga até a próxima sincronização.
            setCaptainRide(null)
            props.setRide?.(null)
            setShowCancelModal(false)
            props.setConfirmRidePopupPanel(false)
            props.setRidePopupPanel(false)
        } catch (err) {
            if (!isCurrent()) return
            console.error('Captain cancel error:', err)
            addToast(err.response?.data?.message || 'Não foi possível cancelar. Tente novamente.', 'error')
        } finally {
            actionRef.current = false
            if (mountedRef.current) setCancelling(false)
        }
    }

    const openCancelModal = () => {
        if (actionRef.current || !validPickup) return
        setSelectedReason('')
        setCustomReason('')
        setShowCancelModal(true)
    }

    const runTransition = async (status) => {
        if (!validPickup || actionRef.current) return
        actionRef.current = true
        const target = props.ride
        const captainId = captain._id
        const starting = status === 'started'
        const occurredAt = Date.now()
        const isCurrent = () => mountedRef.current
            && currentRef.current.captainId === captainId
            && currentRef.current.ride?._id === target._id
            && PICKUP_STATES.includes(currentRef.current.ride?.status)
        const apply = (updatedRide) => {
            if (!isCurrent()) return
            if (PICKUP_STATES.indexOf(currentRef.current.ride.status) > PICKUP_STATES.indexOf(updatedRide.status)
                && updatedRide.status !== 'started') return
            props.setRide?.(updatedRide)
            setCaptainRide(updatedRide)
            setRideStatus(deriveStatusFromRide(updatedRide.status))
            if (updatedRide.status === 'started') {
                props.setConfirmRidePopupPanel(false)
                props.setRidePopupPanel(false)
                navigate('/captain-riding', { replace: true, state: { ride: updatedRide } })
            }
        }
        setLoading(true)
        try {
            const response = await withHardTimeout(starting
                ? api.get('/rides/start-ride', { params: { rideId: target._id, occurredAt } })
                : api.post('/rides/update-status', { rideId: target._id, status }))
            if (response.data?._id !== target._id
                || !isRideAssignedToCaptain(response.data, captainId)
                || response.data.status !== status) {
                throw new Error('Resposta de atualização incompleta.')
            }
            apply(response.data)
        } catch (err) {
            if (!isCurrent()) return
            if (isRideConnectivityError(err)) {
                setSavingOffline(true)
                const savedRide = { ...target, status,
                    ...(starting ? { startedAt: new Date(occurredAt).toISOString() } : {}),
                }
                try {
                    await enqueueOfflineAction({
                        type: starting ? 'start-ride' : 'update-ride-status',
                        rideId: target._id,
                        payload: { rideId: target._id, ...(starting ? { occurredAt } : { status }) },
                        rideSnapshot: savedRide,
                    })
                    if (!isCurrent()) return
                    apply(savedRide)
                    addToast(`${starting ? 'Início salvo' : 'Etapa salva'} no aparelho. Sincroniza quando a conexão voltar.`, 'info')
                } catch (storageError) {
                    if (!isCurrent()) return
                    addToast('Não foi possível salvar no aparelho. A etapa não foi avançada. Verifique o armazenamento e tente novamente.', 'error')
                    Sentry.captureException(storageError, { tags: { issue: 'offline_storage' } })
                }
            } else {
                addToast(err.response?.data?.message || 'Não foi possível confirmar esta etapa. Tente novamente.', 'error')
                Sentry.captureException(err, { tags: { issue: 'api_error' } })
            }
        } finally {
            actionRef.current = false
            if (mountedRef.current) {
                setSavingOffline(false)
                setLoading(false)
            }
        }
    }
    const updateStatus = (status) => runTransition(status)
    const startRide = () => runTransition('started')
    const stage = rideStatus === 'arrived'
        ? { title: 'Você chegou ao embarque', instruction: 'Aguarde o passageiro. Inicie a corrida somente depois que ele embarcar.' }
        : rideStatus === 'going_to_pickup'
            ? { title: 'Indo buscar o passageiro', instruction: 'Siga até o endereço de embarque. Toque em “Cheguei ao local” quando chegar.' }
            : { title: 'Corrida aceita', instruction: 'Confira o embarque e toque em “A caminho” quando sair para buscar o passageiro.' }
    const pickupPoint = props.ride?.pickupCoordinates
    const pickupMapsUrl = buildGoogleMapsUrl({ lat: pickupPoint?.lat ?? pickupPoint?.ltd,
        lng: pickupPoint?.lng, address: props.ride?.pickup })
    // Apenas o contato entregue pelo DTO pós-aceite; nunca adivinha um número.
    const passengerPhone = String(props.ride?.user?.phone || '').trim().replace(/[()\s.-]/g, '')
    const phoneUrl = /^\+?\d{8,15}$/.test(passengerPhone) ? `tel:${passengerPhone}` : null

    if (!validPickup) return <p role="status" className="p-4 text-sm text-ink-700">
        Aguardando uma corrida atribuída ao motorista. Confira a viagem em Corridas.
    </p>

    return (
        <div className="pb-1">
            <div className='flex flex-wrap items-center justify-between mb-2.5 gap-2'>
                <h3 className='text-lg font-semibold text-ink-900'>{stage.title}</h3>
                {props.ride?.fare != null && (
                    <p className="text-right text-base font-bold text-ink-900"><span className="block text-xs font-normal">Estimativa da viagem</span>{formatBRL(props.ride.fare)}</p>
                )}
            </div>
            <p className="mb-3 text-sm text-ink-700">{stage.instruction}</p>
            <PassengerIdentityCard
                user={props.ride?.user}
                showPhoto
                compact
                trailing={
                    <div className="text-right">
                        <p className="text-xs text-ink-700">
                            {paymentMethodLabel(props.ride?.paymentMethod)}
                        </p>
                    </div>
                }
            />
            <div className='mt-3 space-y-3 rounded-xl border border-line p-3'>
                <p className='text-sm text-ink-900 flex items-start gap-2 min-w-0'>
                    <i className="ri-map-pin-user-fill text-brand-500 flex-shrink-0" aria-hidden="true" />
                    <span className="break-words min-w-0"><span className="block text-xs text-ink-600">Buscar passageiro em</span>{props.ride?.pickup || 'Endereço de embarque indisponível'}</span>
                </p>
                <p className='text-sm text-ink-700 flex items-start gap-2 min-w-0'>
                    <i className="ri-map-pin-2-fill text-danger-500 flex-shrink-0" aria-hidden="true" />
                    <span className="break-words min-w-0"><span className="block text-xs text-ink-600">Destino da viagem</span>{props.ride?.destination || 'Destino indisponível'}</span>
                </p>
                {props.ride?.estimatedDistance > 0 && <p className="text-xs text-ink-600">Percurso previsto da viagem: {(props.ride.estimatedDistance / 1000).toFixed(1)} km. Não é a distância até o passageiro.</p>}
            </div>
            {pickupMapsUrl && <a href={pickupMapsUrl} target="_blank" rel="noopener noreferrer"
                className="flex min-h-[44px] items-center justify-center mt-2 text-sm font-semibold underline text-brand-700">
                Abrir embarque no Google Maps
            </a>}
            {phoneUrl ? <a href={phoneUrl} className="flex min-h-[44px] items-center justify-center text-sm font-semibold underline text-ink-900">
                Ligar para o passageiro
            </a> : <p className="text-xs text-ink-600 mt-2">Telefone do passageiro não informado.</p>}

            <div className='mt-3 w-full'>
                    {loading && <p role="status" className="mb-2 text-sm text-ink-700">
                        {savingOffline ? 'Salvando no aparelho...' : 'Confirmando etapa...'}
                    </p>}
                    {rideStatus === 'accepted' && (
                        <Button
                            onClick={() => updateStatus('going_to_pickup')}
                            loading={loading}
                            disabled={cancelling || showCancelModal}
                            className="!min-h-[44px] !text-sm"
                        >
                            A caminho
                        </Button>
                    )}

                    {rideStatus === 'going_to_pickup' && (
                        <Button
                            onClick={() => updateStatus('arrived')}
                            loading={loading}
                            disabled={cancelling || showCancelModal}
                            className="!min-h-[44px] !text-sm"
                        >
                            Cheguei ao local
                        </Button>
                    )}

                    {rideStatus === 'arrived' && (
                        <Button onClick={startRide} loading={loading} disabled={cancelling || showCancelModal} className="!min-h-[44px] !text-sm">
                            Iniciar corrida
                        </Button>
                    )}

                    <Button
                        type="button"
                        variant="secondary"
                        onClick={openCancelModal}
                        disabled={loading || cancelling}
                        className="mt-2 !min-h-[40px] !text-sm"
                    >Cancelar</Button>
            </div>

            {showCancelModal && (
                <div className="mt-4 border-t border-line pt-4">
                    <div className="bg-white rounded-panel w-full">
                        <h3 className="text-lg font-semibold text-ink-900">Cancelar corrida?</h3>
                        <p className="text-sm text-ink-600 mt-1">
                            {reasonRequired
                                ? 'Você já chegou ao local. Informe o motivo. Ao confirmar, você deixa este atendimento e a corrida volta a buscar outro motorista.'
                                : 'Isso libera a corrida para outro motorista aceitar.'}
                        </p>

                        <div className="mt-4 space-y-2">
                            {CANCEL_REASONS.map((reason) => (
                                <label
                                    key={reason}
                                    className={`flex items-center gap-3 p-3 rounded-panel border-2 cursor-pointer ${selectedReason === reason ? 'border-brand-500 bg-brand-50' : 'border-line'}`}
                                >
                                    <input
                                        type="radio"
                                        name="cancel-reason"
                                        value={reason}
                                        checked={selectedReason === reason}
                                        onChange={() => setSelectedReason(reason)}
                                        className="accent-brand-500"
                                    />
                                    <span className="text-sm text-ink-900">{reason}</span>
                                </label>
                            ))}
                            {selectedReason === 'Outro' && (
                                <textarea
                                    value={customReason}
                                    onChange={(e) => setCustomReason(e.target.value)}
                                    placeholder="Descreva o motivo"
                                    maxLength={500}
                                    rows={2}
                                    className="w-full mt-1 p-3 text-sm rounded-panel border-2 border-line focus:border-brand-500 focus:outline-none"
                                />
                            )}
                        </div>

                        {reasonRequired && !canConfirmCancel && (
                            <p className="text-xs text-danger-600 mt-2">Selecione um motivo para continuar.</p>
                        )}

                        <div className="flex gap-2 mt-4">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setShowCancelModal(false)}
                                className="flex-1"
                            >Voltar</Button>
                            <Button
                                type="button"
                                variant="danger"
                                onClick={cancelRide}
                                loading={cancelling}
                                disabled={!canConfirmCancel}
                                className="flex-1"
                            >Confirmar cancelamento</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default ConfirmRidePopUp
