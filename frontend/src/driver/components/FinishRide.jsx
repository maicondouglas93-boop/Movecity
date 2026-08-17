import React, { useState, useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import { enqueueOfflineAction, flushQueuedLocations } from '@/shared/services/offlineQueue'
import { buildOfflineFinishPreview } from '@/shared/services/offlineRideFare'
import { withHardTimeout } from '@/shared/utils/hardTimeout'
import { getAccessToken } from '@/shared/services/session'
import * as Sentry from '@sentry/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/shared/components/ui/Button'
import PassengerIdentityCard from '@/shared/components/PassengerIdentityCard'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { useToast } from '@/shared/contexts/ToastContext'
import { formatBRL } from '@/shared/utils/currency'

const formatCurrency = (amount) => new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
}).format(Number(amount) || 0)

const isNetworkError = (error) => (
    (typeof navigator !== 'undefined' && !navigator.onLine)
    || error?.message === 'Network Error'
    // Teto de tempo estourado ou GPS que não sincronizou: os dois são falta de
    // conectividade, não erro de regra do servidor. Precisam cair no mesmo caminho
    // (guardar a finalização na fila) em vez de virar um toast que perde a corrida.
    || error?.isConnectivityIssue === true
)

const FinishRide = (props) => {
    const [ended, setEnded] = useState(false)
    const [paymentConfirmed, setPaymentConfirmed] = useState(false)
    // Finalização e pagamento têm confirmações independentes. Uma corrida finalizada
    // offline não tem preço final e não pode seguir para cobrança.
    const [pendingFinalizationSync, setPendingFinalizationSync] = useState(false)
    const [pendingPaymentSync, setPendingPaymentSync] = useState(false)
    const [endedRide, setEndedRide] = useState(null)
    // Finalização offline não passa pela mutation, então precisa do próprio estado de
    // carregamento — sem ele o botão não trava e um toque duplo enfileira duas vezes.
    const [queueingOffline, setQueueingOffline] = useState(false)
    // Auditoria de UX do motorista (2026-08-02, Etapa 7): "o motorista nunca avalia o
    // passageiro, embora reviewApi.js exista no projeto" — o backend já suportava o tipo
    // 'driver_to_passenger' no schema de review, só nunca tinha endpoint pra usá-lo.
    const [showRating, setShowRating] = useState(false)
    const [ratingValue, setRatingValue] = useState(0)
    const [submittingRating, setSubmittingRating] = useState(false)
    const navigate = useNavigate()
    const { setCaptainRide, syncCaptainRide } = useContext(RideContext)
    const { addToast } = useToast()
    // Auditoria de UX (2026-08-16): motorista via um valor na tela e a corrida fechava
    // com outro maior — a cobrança sempre esteve certa, mas o valor "ao vivo" só
    // atualiza quando chega GPS novo, e pode ficar minutos parado (sinal ruim na
    // estrada, corrida praticamente parada perto do fim). Antes de finalizar de
    // verdade, busca um valor fresco (mesma conta que a finalização vai usar) e pede
    // confirmação — em vez do motorista só descobrir o valor real depois de já ter
    // travado a corrida como finalizada.
    const [previewFare, setPreviewFare] = useState(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const { userLocation } = useContext(LocationContext)
    const { socket } = useContext(SocketContext)

    // Fase 3 (M1, 2026-08-05): os setTimeout de navegação/avaliação pós-corrida eram
    // órfãos — desmontar este painel (ex.: corrida cancelada no meio) deixava um
    // navigate/setState pendente disparar em componente morto.
    const timersRef = useRef([])
    const scheduleTimer = (fn, ms) => {
        timersRef.current.push(setTimeout(fn, ms))
    }
    useEffect(() => () => {
        timersRef.current.forEach(clearTimeout)
    }, [])

    const chargeRide = endedRide || props.ride
    const hasFinalPrice = chargeRide?.finalPrice !== null && chargeRide?.finalPrice !== undefined
    const finalGross = hasFinalPrice ? Number(chargeRide.finalPrice) || 0 : null
    const walletAmountUsed = Math.max(0, Number(chargeRide?.walletAmountUsed) || 0)
    const passengerAmount = finalGross === null ? null : Math.max(0, finalGross - walletAmountUsed)
    const isWalletPayment = chargeRide?.paymentMethod === 'carteira'
    const walletPaymentPending = isWalletPayment && chargeRide?.paymentStatus !== 'paid'
    const finalBreakdown = chargeRide?.fareBreakdown || {}
    const finalDistanceKm = Math.max(0, Number(chargeRide?.actualDistance) || 0) / 1000
    const finalMinutes = Math.max(0, Number(chargeRide?.actualTime) || 0) / 60

    const queryClient = useQueryClient();

    // Liquidação (comissão + repasse) agora acontece na própria finalização da
    // corrida (2026-08-16), não mais num toque separado de "Pagamento Recebido" —
    // exceto no caso raro de carteira com saldo insuficiente, que segue pendente
    // (ver isWalletPayment/walletPaymentPending mais abaixo). Extraído porque o
    // mesmo efeito colateral agora dispara em dois lugares: aqui (finalização) e no
    // confirmPaymentMutation abaixo (fallback manual, ainda usado se a liquidação
    // automática não fechar por algum motivo).
    function handlePaymentSettled() {
        setPaymentConfirmed(true)
        queryClient.invalidateQueries({ queryKey: ['captainWallet'] })
        queryClient.invalidateQueries({ queryKey: ['captainTransactions'] })
        queryClient.invalidateQueries({ queryKey: ['captainHistory'] })
        if (props.ride?.user) {
            scheduleTimer(() => setShowRating(true), 1200)
        } else {
            scheduleTimer(() => {
                setCaptainRide(null)
                navigate('/captain-home')
            }, 1500)
        }
    }

    const endRideMutation = useMutation({
        mutationFn: async () => {
            // A finalização só pode congelar a distância depois que todos os pontos já
            // coletados desta corrida receberam ack do backend. Se a rede oscilar aqui,
            // o botão falha com segurança e os pontos permanecem para retry.
            try {
                await flushQueuedLocations(socket, { rideId: props.ride._id })
            } catch (flushError) {
                // GPS não sincronizou: é falta de conectividade, não erro de regra.
                // Guardar na fila é seguro e correto — o replay drena o GPS antes de
                // reenviar, então a distância nunca fecha incompleta.
                flushError.isConnectivityIssue = true
                throw flushError
            }

            const response = await withHardTimeout(
                api.post(`${import.meta.env.VITE_BASE_URL}/rides/end-ride`, {
                    rideId: props.ride._id,
                    ...(userLocation?.lat != null && userLocation?.lng != null ? {
                        finishLat: userLocation.lat,
                        finishLng: userLocation.lng,
                        finishAccuracy: userLocation.accuracy ?? null,
                        finishTimestamp: userLocation.timestamp ?? Date.now(),
                    } : {}),
                }, {
                    headers: {
                        Authorization: `Bearer ${getAccessToken('captain')}`
                    }
                }),
            )
            return response.data;
        },
        onSuccess: (data) => {
            setEnded(true)
            setPendingFinalizationSync(false)
            setEndedRide(data)
            // Fase A da experiência de corrida ativa (2026-08-03): espelha a corrida
            // finalizada no RideContext — sem isso, ele ficava com status 'started'
            // obsoleto e a Home mostraria "corrida em andamento" pra uma corrida que
            // já acabou (até a próxima sincronização com o backend).
            setCaptainRide(data)
            queryClient.invalidateQueries({ queryKey: ['captainHistory'] })
            if (data?.paymentStatus === 'paid') {
                handlePaymentSettled()
            }
        },
        onError: async (err) => {
            console.error('End ride error:', err)
            if (isNetworkError(err)) {
                await queueFinalizationOffline()
                return
            }
            addToast(err.response?.data?.message || 'Não foi possível finalizar a corrida.', 'error')
            if (typeof navigator === 'undefined' || navigator.onLine) {
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
            }
        }
    })

    // Guarda a finalização pra sincronizar depois e libera o motorista pra cobrar.
    // Vive fora do onError porque agora também é chamada ANTES de tentar a rede,
    // quando o app já sabe que está sem sinal.
    async function queueFinalizationOffline() {
        const presentialPending = props.ride?.source === 'driver_initiated'
            && (props.ride?.destinationPending || !props.ride?.destination)
        const localPreview = previewFare?.offline ? previewFare : await buildOfflineFinishPreview(props.ride)

        if (presentialPending && !(localPreview?.amount > 0)) {
            addToast('Sem internet neste destino. Mantenha o app aberto e toque em Finalizar de novo — o valor sai do GPS guardado no celular.', 'error')
            return
        }

        try {
            await enqueueOfflineAction({
                type: 'end-ride',
                rideId: props.ride._id,
                payload: {
                    rideId: props.ride._id,
                    finishLat: userLocation?.lat,
                    finishLng: userLocation?.lng,
                    finishAccuracy: userLocation?.accuracy ?? null,
                    finishTimestamp: userLocation?.timestamp ?? Date.now(),
                }
            })
            setEnded(true)
            setEndedRide(localPreview?.amount > 0
                ? {
                    ...props.ride,
                    finalPrice: localPreview.amount,
                    actualDistance: localPreview.actualDistance,
                    actualTime: localPreview.elapsedSeconds,
                    fareBreakdown: localPreview.fareBreakdown,
                }
                : null)
            setPendingFinalizationSync(true)
            addToast(
                localPreview?.amount > 0
                    ? 'Sem sinal — cobre o valor mostrado. A corrida confirma no sistema quando a internet voltar.'
                    : 'Finalização pendente. Aguarde o valor final antes de cobrar o passageiro.',
                'warning',
            )
        } catch (queueError) {
            console.error('Could not queue end ride action:', queueError)
            addToast('Não foi possível guardar a finalização para sincronizar. Tente novamente com internet.', 'error')
        }
    }

    async function endRide() {
        // Sem sinal conhecido: guarda direto, sem tentar a rede. Antes a fila só era
        // alimentada pelo onError, então o app precisava que a requisição FALHASSE pra
        // guardar a finalização — e sem conectividade ela não falha, fica pendurada.
        // O motorista via o botão girando pra sempre e, se fechasse o app, perdia a
        // corrida. O replay drena o GPS antes de reenviar, então pular o flush aqui é
        // seguro (ver replayOfflineActions em offlineQueue.js).
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            if (queueingOffline) return
            setQueueingOffline(true)
            try {
                await queueFinalizationOffline()
            } finally {
                setQueueingOffline(false)
            }
            return
        }
        endRideMutation.mutate();
    }

    // Busca /rides/captain-current, que agora devolve liveFare com a mesma conta
    // (distância já registrada + tempo recalculado na hora) que a finalização real vai
    // usar. Sem liveFare utilizável (corrida presencial sem destino/distância ainda,
    // ou a busca falhou) segue direto pra finalização — ela já valida e recalcula
    // corretamente sozinha, então não travar o motorista numa prévia impossível.
    async function handleFinalizeClick() {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setPreviewLoading(true)
            try {
                const local = await buildOfflineFinishPreview(props.ride)
                if (local?.amount > 0) {
                    setPreviewFare(local)
                    return
                }
                addToast('Sem internet e GPS insuficiente para calcular o valor. Deixe o app aberto e tente de novo.', 'error')
            } finally {
                setPreviewLoading(false)
            }
            return
        }

        setPreviewLoading(true)
        try {
            const fresh = await syncCaptainRide()
            if (fresh?.liveFare?.amount > 0) {
                setPreviewFare(fresh.liveFare)
            } else {
                endRide()
            }
        } catch (err) {
            console.error('Erro buscando prévia do valor final:', err)
            const local = await buildOfflineFinishPreview(props.ride)
            if (local?.amount > 0) {
                setPreviewFare(local)
                return
            }
            endRide()
        } finally {
            setPreviewLoading(false)
        }
    }

    const confirmPaymentMutation = useMutation({
        mutationFn: async () => {
            const response = await withHardTimeout(
                api.post(`${import.meta.env.VITE_BASE_URL}/rides/confirm-payment`, {
                    rideId: props.ride._id
                }, {
                    headers: {
                        Authorization: `Bearer ${getAccessToken('captain')}`
                    }
                }),
            )
            return response.data;
        },
        onSuccess: handlePaymentSettled,
        onError: async (err) => {
            console.error('Confirm payment error:', err)
            if (isNetworkError(err)) {
                await queuePaymentOffline()
                return
            }
            Sentry.captureException(err, { tags: { issue: 'api_error' } });
            addToast(err.response?.data?.message || 'Não foi possível confirmar o pagamento.', 'error')
        }
    })

    // Mesmo motivo do queueFinalizationOffline: sem conectividade a requisição não
    // falha, fica pendurada, e o onError — onde mora o enfileiramento — nunca roda.
    async function queuePaymentOffline() {
        try {
            await enqueueOfflineAction({
                type: 'confirm-payment',
                rideId: props.ride._id,
                payload: { rideId: props.ride._id }
            })
            setPaymentConfirmed(true)
            setPendingPaymentSync(true)
            setCaptainRide(null)
            scheduleTimer(() => navigate('/captain-home'), 2500)
        } catch (queueError) {
            console.error('Could not queue payment confirmation:', queueError)
            addToast('Não foi possível guardar a confirmação de pagamento. Tente novamente com internet.', 'error')
        }
    }

    async function confirmPayment() {
        // Sem sinal conhecido: guarda direto. A finalização enfileirada já liquida o
        // pagamento sozinha quando sincroniza (desde 2026-08-16), então esta ação vira
        // um 409 "já confirmado" no replay — que a fila trata como sucesso.
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            if (queueingOffline) return
            setQueueingOffline(true)
            try {
                await queuePaymentOffline()
            } finally {
                setQueueingOffline(false)
            }
            return
        }
        confirmPaymentMutation.mutate();
    }

    async function submitRating() {
        if (ratingValue === 0) {
            navigate('/captain-home')
            return
        }
        setSubmittingRating(true)
        try {
            await api.post(`${import.meta.env.VITE_BASE_URL}/rides/captain-review`, {
                rideId: props.ride._id,
                rating: ratingValue
            }, {
                headers: { Authorization: `Bearer ${getAccessToken('captain')}` }
            })
        } catch (err) {
            console.error('Captain review error:', err)
            // Não trava a navegação por causa disso — a corrida já foi paga e concluída,
            // a avaliação é um extra.
        } finally {
            navigate('/captain-home')
        }
    }

    return (
        <div>
            {!ended ? previewFare ? (
                <>
                    <h3 className='text-base font-semibold mb-2.5 text-ink-900'>Confirmar valor final</h3>
                    <p className='text-xs text-ink-600 mb-3'>
                        {previewFare?.offline
                            ? 'Sem internet neste destino. Valor calculado no celular com o GPS desta corrida. Cobre este valor agora.'
                            : 'Valor calculado agora, com a distância e o tempo reais desta corrida.'}
                    </p>

                    <div className='bg-surface border border-line rounded-panel p-4 mb-4'>
                        <div className='space-y-2 text-sm'>
                            <div className='flex justify-between gap-3'>
                                <span className='text-ink-600'>Distância percorrida</span>
                                <span className='font-semibold text-ink-900'>{(Math.max(0, Number(previewFare.actualDistance) || 0) / 1000).toFixed(1)} km</span>
                            </div>
                            <div className='flex justify-between gap-3'>
                                <span className='text-ink-600'>Tempo da corrida</span>
                                <span className='font-semibold text-ink-900'>{Math.round(Math.max(0, Number(previewFare.elapsedSeconds) || 0) / 60)} min</span>
                            </div>
                            <div className='flex justify-between gap-3'>
                                <span className='text-ink-600'>Tarifa base</span>
                                <span className='font-semibold text-ink-900'>{formatBRL(previewFare.fareBreakdown?.baseFare || 0)}</span>
                            </div>
                            <div className='flex justify-between gap-3'>
                                <span className='text-ink-600'>Distância</span>
                                <span className='font-semibold text-ink-900'>{formatBRL(previewFare.fareBreakdown?.distanceFare || 0)}</span>
                            </div>
                            <div className='flex justify-between gap-3'>
                                <span className='text-ink-600'>Minutos</span>
                                <span className='font-semibold text-ink-900'>{formatBRL(previewFare.fareBreakdown?.timeFare || 0)}</span>
                            </div>
                        </div>
                    </div>

                    <div className='bg-surface-alt rounded-panel p-5 border border-line mb-5 text-center'>
                        <p className='text-ink-600 text-sm mb-1'>Valor total da corrida</p>
                        <p className='text-brand-600 text-3xl font-black'>{formatBRL(previewFare.amount)}</p>
                    </div>

                    <p className='text-xs text-ink-500 text-center mb-4'>
                        {previewFare?.offline
                            ? 'Quando o sinal voltar, o sistema confirma. Pode variar alguns centavos.'
                            : 'Pode variar centavos se o app captar mais deslocamento até você confirmar.'}
                    </p>

                    <div className='flex gap-2'>
                        <Button
                            variant="ghost"
                            fullWidth={false}
                            className="flex-1 !min-h-[44px] !text-sm"
                            onClick={() => setPreviewFare(null)}
                            disabled={endRideMutation.isPending || queueingOffline}
                        >
                            Voltar
                        </Button>
                        <Button
                            fullWidth={false}
                            className="flex-1 !min-h-[44px] !text-sm"
                            onClick={endRide}
                            loading={endRideMutation.isPending || queueingOffline}
                        >
                            Confirmar e finalizar
                        </Button>
                    </div>
                </>
            ) : (
                <>
                    <h3 className='text-base font-semibold mb-2.5 text-ink-900'>Finalizar corrida</h3>
                    {props.ride?.user ? (
                        <PassengerIdentityCard
                            user={props.ride.user}
                            showPhoto
                            compact
                            trailing={
                                <p className='text-sm font-bold text-ink-900'>
                                    {props.ride?.estimatedDistance
                                        ? `${(props.ride.estimatedDistance / 1000).toFixed(1)} km`
                                        : '—'}
                                </p>
                            }
                        />
                    ) : props.ride?.source === 'driver_initiated' ? (
                        <div className='rounded-panel border border-line bg-surface-alt px-3 py-2'>
                            <p className='text-sm font-semibold text-brand-700'>Corrida presencial</p>
                            <p className='text-xs text-ink-600 mt-0.5'>Passageiro sem conta vinculada</p>
                        </div>
                    ) : null}
                    <div className='mt-2.5 space-y-1.5'>
                        <p className='text-xs text-ink-700 flex items-center gap-2 min-w-0'>
                            <i className="ri-map-pin-user-fill text-brand-500 flex-shrink-0" aria-hidden="true" />
                            <span className="truncate font-medium">{props.ride?.pickup?.split(',')[0]}</span>
                        </p>
                        <p className='text-xs text-ink-700 flex items-center gap-2 min-w-0'>
                            <i className="ri-map-pin-2-fill text-danger-500 flex-shrink-0" aria-hidden="true" />
                            <span className="truncate font-medium">
                                {props.ride?.destinationPending
                                    ? 'Será definido ao finalizar'
                                    : (props.ride?.destination?.split(',')[0] || 'Destino')}
                            </span>
                        </p>
                        <p className='text-xs text-ink-700 flex items-center gap-2'>
                            <i className="ri-currency-line text-brand-500 flex-shrink-0" aria-hidden="true" />
                            <span className="font-semibold text-ink-900">
                                {props.ride?.destinationPending
                                    ? 'Preço ao finalizar'
                                    : `Estimativa: ${formatCurrency(props.ride?.fare)}`}
                            </span>
                            <span className="text-ink-500">
                                · {props.ride?.paymentMethod === 'pix' ? 'Pix' : props.ride?.paymentMethod === 'carteira' ? 'Carteira' : props.ride?.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'}
                            </span>
                        </p>
                    </div>

                    <Button
                        onClick={handleFinalizeClick}
                        loading={previewLoading || endRideMutation.isPending}
                        className="mt-3 !min-h-[44px] !text-sm"
                    >
                        Finalizar corrida
                    </Button>
                </>
            ) : pendingFinalizationSync ? (
                <div className='flex flex-col items-center justify-center py-10 gap-4'>
                    <div className='bg-amber-100 rounded-full p-4'>
                        <i className='ri-time-line text-amber-600 text-5xl'></i>
                    </div>
                    <h3 className='text-xl font-bold text-amber-700 text-center'>
                        {passengerAmount != null ? 'Cobre o cliente agora' : 'Finalização aguardando conexão'}
                    </h3>
                    {passengerAmount != null ? (
                        <>
                            <p className='text-ink-600 text-center'>Sem sinal no destino. Este valor foi calculado com o GPS do celular. Receba em dinheiro ou Pix e confirme abaixo.</p>
                            <p className='text-3xl font-black text-brand-600'>{formatBRL(passengerAmount)}</p>
                            <p className='text-xs text-ink-500 text-center'>A confirmação no sistema vai sozinha quando a internet voltar. Pode variar alguns centavos.</p>
                            <Button onClick={confirmPayment} loading={confirmPaymentMutation.isPending || queueingOffline}>
                                Pagamento recebido
                            </Button>
                        </>
                    ) : (
                        <>
                            <p className='text-ink-600 text-center'>A corrida foi guardada para sincronizar. O valor final será calculado pelo servidor quando a internet voltar.</p>
                            <p className='text-sm font-semibold text-danger-600 text-center'>Não cobre o passageiro até receber o valor final.</p>
                        </>
                    )}
                </div>
            ) : showRating ? (
                <div className='flex flex-col items-center justify-center py-8 gap-4'>
                    <h3 className='text-xl font-bold text-ink-900 text-center'>
                        Como foi a corrida com {props.ride?.user?.fullname?.firstname || 'o passageiro'}?
                    </h3>
                    <div className='flex gap-2'>
                        {[1, 2, 3, 4, 5].map(n => (
                            <button
                                key={n}
                                type="button"
                                onClick={() => setRatingValue(n)}
                                aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
                                className='p-1'
                            >
                                <i className={`text-4xl ${n <= ratingValue ? 'ri-star-fill text-yellow-400' : 'ri-star-line text-ink-400'}`}></i>
                            </button>
                        ))}
                    </div>
                    <div className='w-full flex flex-col gap-2 mt-2'>
                        <Button onClick={submitRating} loading={submittingRating} disabled={ratingValue === 0}>
                            Enviar avaliação
                        </Button>
                        <Button variant="ghost" onClick={() => navigate('/captain-home')}>
                            Pular
                        </Button>
                    </div>
                </div>
            ) : paymentConfirmed ? (
                <div className='flex flex-col items-center justify-center py-10 gap-4'>
                    <div className={pendingPaymentSync ? 'bg-amber-100 rounded-full p-4' : 'bg-brand-100 rounded-full p-4'}>
                        <i className={pendingPaymentSync ? 'ri-time-line text-amber-600 text-5xl' : 'ri-checkbox-circle-fill text-brand-500 text-5xl'}></i>
                    </div>
                    {pendingPaymentSync ? (
                        <>
                            <h3 className='text-xl font-bold text-amber-700'>Serviço concluído</h3>
                            <p className='text-ink-600 text-center'>Sem conexão no momento — vamos confirmar com o servidor assim que a internet voltar.</p>
                            <p className='text-2xl font-bold text-ink-900 mt-2'>Valor do passageiro</p>
                            <p className='text-3xl font-black text-brand-600'>{formatBRL(passengerAmount)}</p>
                            <p className='text-ink-600 text-sm'>Redirecionando...</p>
                        </>
                    ) : (
                        <>
                            <h3 className='text-xl font-bold text-brand-700'>Serviço concluído</h3>
                            <p className='text-ink-600 text-center'>Pagamento confirmado</p>
                            <p className='text-3xl font-black text-brand-600'>{formatBRL(passengerAmount)}</p>
                        </>
                    )}
                </div>
            ) : isWalletPayment ? (
                <div className='flex flex-col items-center justify-center py-8 gap-4'>
                    <div className={walletPaymentPending ? 'bg-amber-100 rounded-full p-4' : 'bg-brand-100 rounded-full p-4'}>
                        <i className={walletPaymentPending ? 'ri-time-line text-amber-600 text-5xl' : 'ri-wallet-3-fill text-brand-600 text-5xl'}></i>
                    </div>
                    <h3 className='text-xl font-bold text-ink-900 text-center'>
                        {walletPaymentPending ? 'Pagamento pela carteira pendente' : 'Pagamento pela carteira confirmado'}
                    </h3>
                    <p className='text-ink-600 text-center'>Esta corrida é paga pela carteira do passageiro. Não solicite dinheiro ou Pix diretamente.</p>
                    <p className='text-sm text-ink-500 text-center'>
                        {walletPaymentPending
                            ? 'O valor final excedeu o saldo disponível e o passageiro será avisado para regularizar no app.'
                            : 'O repasse líquido foi conciliado pela plataforma.'}
                    </p>
                    <Button onClick={() => navigate('/captain-home')}>Voltar para o início</Button>
                </div>
            ) : (
                <>
                    <h3 className='text-2xl font-semibold mb-3 text-ink-900'>Confirmar Pagamento</h3>
                    <p className='text-ink-600 mb-5'>Receba o pagamento do passageiro e confirme abaixo.</p>

                    <div className='bg-surface border border-line rounded-panel p-4 mb-4'>
                        <p className='text-sm font-semibold text-ink-900 mb-3'>Cálculo da corrida</p>
                        <div className='space-y-2 text-sm'>
                            <div className='flex justify-between gap-3'>
                                <span className='text-ink-600'>Distância percorrida</span>
                                <span className='font-semibold text-ink-900'>{finalDistanceKm.toFixed(1)} km</span>
                            </div>
                            <div className='flex justify-between gap-3'>
                                <span className='text-ink-600'>Tempo da corrida</span>
                                <span className='font-semibold text-ink-900'>{Math.round(finalMinutes)} min</span>
                            </div>
                            <div className='flex justify-between gap-3'>
                                <span className='text-ink-600'>Tarifa base</span>
                                <span className='font-semibold text-ink-900'>{formatBRL(finalBreakdown.baseFare || 0)}</span>
                            </div>
                            <div className='flex justify-between gap-3'>
                                <span className='text-ink-600'>Distância</span>
                                <span className='font-semibold text-ink-900'>{formatBRL(finalBreakdown.distanceFare || 0)}</span>
                            </div>
                            <div className='flex justify-between gap-3'>
                                <span className='text-ink-600'>Minutos</span>
                                <span className='font-semibold text-ink-900'>{formatBRL(finalBreakdown.timeFare || 0)}</span>
                            </div>
                            {Number(finalBreakdown.minimumFareAdjustment) > 0 && (
                                <div className='flex justify-between gap-3'>
                                    <span className='text-ink-600'>Ajuste da tarifa mínima</span>
                                    <span className='font-semibold text-ink-900'>{formatBRL(finalBreakdown.minimumFareAdjustment)}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Valor que o passageiro deve pagar (sem comissão/%). */}
                    <div className='bg-surface-alt rounded-panel p-5 border border-line mb-5 text-center'>
                        <p className='text-ink-600 text-sm mb-1'>Cliente deve pagar</p>
                        <p className='text-brand-600 text-3xl font-black'>{formatBRL(passengerAmount)}</p>
                    </div>

                    <div className='bg-surface-alt border border-line rounded-panel p-3 mb-5 flex items-start gap-2'>
                        <i className="ri-information-line text-ink-400 mt-0.5"></i>
                        <p className='text-sm text-ink-600'>Cliente paga direto a você. Confirme quando o pagamento for recebido.</p>
                    </div>

                    <Button onClick={confirmPayment} loading={confirmPaymentMutation.isPending || queueingOffline}>
                        <i className="ri-hand-coin-fill text-xl"></i>
                        Pagamento Recebido
                    </Button>
                </>
            )}
        </div>
    )
}

export default FinishRide
