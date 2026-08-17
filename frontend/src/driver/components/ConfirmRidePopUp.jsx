import React, { useState, useEffect, useContext } from 'react'
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

// Fase A da experiência de corrida ativa (2026-08-03): o status dos botões vem da
// corrida real (backend), não mais de um useState fixo em 'accepted' — depois de um
// refresh, os botões voltavam pra "A caminho" mesmo com o motorista já no local.
// 'waiting_passenger' mostra a mesma UI de 'arrived' (campo do PIN).
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
    const [otp, setOtp] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [rideStatus, setRideStatus] = useState(deriveStatusFromRide(props.ride?.status))
    const [cancelling, setCancelling] = useState(false)
    const [showCancelModal, setShowCancelModal] = useState(false)
    const [selectedReason, setSelectedReason] = useState('')
    const [customReason, setCustomReason] = useState('')
    const navigate = useNavigate()
    const { addToast } = useToast()
    const { setCaptainRide, syncCaptainRide } = useContext(RideContext)

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
        if (!canConfirmCancel) return
        setCancelling(true)
        try {
            // Via api (@/shared/services/axios): token do motorista + refresh automático em
            // 401. Antes usava axios cru com header manual — access token de 15 min
            // vencido gerava 401 sem renovação (botões "A caminho"/"Cheguei" mortos).
            await api.post('/rides/captain-cancel', { rideId: props.ride._id, reason: resolvedReason || undefined })
            addToast('Corrida liberada — buscando outro motorista para o passageiro.', 'info')
            // Limpa a corrida no RideContext na hora — sem isso, o efeito de restauração
            // do CaptainHome ainda veria a corrida antiga até a próxima sincronização.
            setCaptainRide(null)
            setShowCancelModal(false)
            props.setConfirmRidePopupPanel(false)
            props.setRidePopupPanel(false)
        } catch (err) {
            console.error('Captain cancel error:', err)
            addToast(err.response?.data?.message || 'Não foi possível cancelar. Tente novamente.', 'error')
        } finally {
            setCancelling(false)
        }
    }

    const openCancelModal = () => {
        setSelectedReason('')
        setCustomReason('')
        setShowCancelModal(true)
    }

    const updateStatus = async (status) => {
        setLoading(true)
        try {
            const response = await withHardTimeout(api.post('/rides/update-status', {
                rideId: props.ride._id,
                status: status
            }))
            const updatedRide = response.data || await syncCaptainRide?.()
            if (updatedRide) {
                props.setRide?.(updatedRide)
                setCaptainRide(updatedRide)
                setRideStatus(deriveStatusFromRide(updatedRide.status))
            } else {
                setRideStatus(status)
            }
        } catch (err) {
            console.error('Update status error:', err)
            if (!navigator.onLine || err.message === 'Network Error') {
                enqueueOfflineAction({
                    type: 'update-ride-status',
                    rideId: props.ride._id,
                    payload: { rideId: props.ride._id, status }
                }).catch(e => console.error(e));
                const optimisticRide = { ...props.ride, status }
                props.setRide?.(optimisticRide)
                setCaptainRide(optimisticRide)
                setRideStatus(status); // optimistic
            } else {
                // Auditoria do app do motorista (2026-08-11, P1): antes ficava em `error`,
                // um estado só renderizado dentro do formulário de PIN — uma falha aqui
                // (rideStatus 'accepted'/'going_to_pickup') não aparecia em lugar nenhum
                // da tela. addToast é visível em qualquer passo, igual ao resto do app.
                addToast(err.response?.data?.message || 'Não foi possível atualizar o status. Tente novamente.', 'error')
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
            }
        } finally {
            setLoading(false)
        }
    }

    const submitHandler = async (e) => {
        e.preventDefault()
        if (!otp || otp.length !== 6) {
            return setError('Digite o PIN de 6 dígitos informado pelo passageiro.')
        }
        setError('')
        setLoading(true)
        try {
            const response = await withHardTimeout(api.get('/rides/start-ride', {
                params: {
                    rideId: props.ride._id,
                    otp: otp
                }
            }))

            if (response.status === 200) {
                const startedRide = { ...(response.data || props.ride), status: 'started' }
                props.setRide?.(startedRide)
                setCaptainRide(startedRide)
                setRideStatus('started')
                props.setConfirmRidePopupPanel(false)
                props.setRidePopupPanel(false)
                navigate('/captain-riding', { replace: true, state: { ride: startedRide } })
            }
        } catch (err) {
            if (!navigator.onLine || err.message === 'Network Error') {
                enqueueOfflineAction({
                    type: 'start-ride',
                    rideId: props.ride._id,
                    // Instante real do embarque. É a partir daqui que a corrida é
                    // cronometrada e que a espera do motorista para de contar.
                    payload: { rideId: props.ride._id, otp: otp, occurredAt: Date.now() }
                }).catch(e => console.error(e));
                const optimisticRide = { ...props.ride, status: 'started' }
                props.setRide?.(optimisticRide)
                setCaptainRide(optimisticRide)
                props.setConfirmRidePopupPanel(false)
                props.setRidePopupPanel(false)
                navigate('/captain-riding', { replace: true, state: { ride: optimisticRide } }) // Optimistic
            } else {
                setError(err.response?.data?.message || 'PIN inválido. Tente novamente.')
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="pb-1">
            <div className='flex items-center justify-between mb-2.5 gap-2'>
                <h3 className='text-base font-semibold text-ink-900'>Iniciar corrida</h3>
                {props.ride?.fare != null && (
                    <p className="text-base font-bold text-ink-900">{formatBRL(props.ride.fare)}</p>
                )}
            </div>
            <PassengerIdentityCard
                user={props.ride?.user}
                showPhoto
                compact
                trailing={
                    <div className="text-right">
                        <p className='text-sm font-bold text-ink-900'>
                            {props.ride?.estimatedDistance
                                ? `${(props.ride.estimatedDistance / 1000).toFixed(1)} km`
                                : '—'}
                        </p>
                        <p className="text-[10px] text-ink-500">
                            {props.ride?.paymentMethod === 'pix' ? 'Pix' : props.ride?.paymentMethod === 'carteira' ? 'Carteira' : props.ride?.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'}
                        </p>
                    </div>
                }
            />
            <div className='mt-2.5 space-y-1.5'>
                <p className='text-xs text-ink-700 flex items-center gap-2 min-w-0'>
                    <i className="ri-map-pin-user-fill text-brand-500 flex-shrink-0" aria-hidden="true" />
                    <span className="truncate font-medium">{props.ride?.pickup?.split(',')[0]}</span>
                </p>
                <p className='text-xs text-ink-700 flex items-center gap-2 min-w-0'>
                    <i className="ri-map-pin-2-fill text-danger-500 flex-shrink-0" aria-hidden="true" />
                    <span className="truncate font-medium">{props.ride?.destination?.split(',')[0]}</span>
                </p>
            </div>

            <div className='mt-3 w-full'>
                    {rideStatus === 'accepted' && (
                        <Button
                            onClick={() => updateStatus('going_to_pickup')}
                            loading={loading}
                            className="!min-h-[44px] !text-sm"
                        >
                            A caminho
                        </Button>
                    )}

                    {rideStatus === 'going_to_pickup' && (
                        <Button
                            onClick={() => updateStatus('arrived')}
                            loading={loading}
                            className="!min-h-[44px] !text-sm"
                        >
                            Cheguei ao local
                        </Button>
                    )}

                    {rideStatus === 'arrived' && (
                        <form onSubmit={submitHandler}>
                            <label htmlFor="captain-otp-input" className='block text-xs font-medium text-ink-600 mb-1'>PIN do passageiro</label>
                            <input
                                id="captain-otp-input"
                                value={otp}
                                onChange={(e) => {
                                    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                                    setOtp(val)
                                    setError('')
                                }}
                                type="text"
                                inputMode="numeric"
                                className='bg-surface-alt px-4 py-3 font-mono text-xl text-center tracking-widest rounded-panel w-full border-2 border-transparent focus:border-brand-500 focus:bg-brand-50 focus:outline-none transition-colors'
                                placeholder='• • • • • •'
                                maxLength={6}
                            />

                            {error && (
                                <div className='flex items-center gap-2 bg-danger-50 border border-danger-500/30 rounded-panel p-2.5 mt-2'>
                                    <i className="ri-error-warning-line text-danger-500"></i>
                                    <p className='text-xs text-danger-600'>{error}</p>
                                </div>
                            )}

                            <Button type="submit" loading={loading} className="mt-2.5 !min-h-[44px] !text-sm">
                                Iniciar corrida
                            </Button>
                        </form>
                    )}

                    <Button
                        type="button"
                        variant="secondary"
                        onClick={openCancelModal}
                        className="mt-2 !min-h-[40px] !text-sm"
                    >Cancelar</Button>
            </div>

            {showCancelModal && (
                <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-t-3xl sm:rounded-panel shadow-2xl w-full sm:max-w-sm p-5 pb-[env(safe-area-inset-bottom,20px)]">
                        <h3 className="text-lg font-semibold text-ink-900">Cancelar corrida?</h3>
                        <p className="text-sm text-ink-600 mt-1">
                            {reasonRequired
                                ? 'Você já chegou ao local — conte o que aconteceu pra gente avisar o passageiro corretamente.'
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
