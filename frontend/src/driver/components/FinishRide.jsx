import { useState, useContext, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import { enqueueOfflineAction, flushQueuedLocations } from '@/shared/services/offlineQueue'
import { buildOfflineFinishPreview } from '@/shared/services/offlineRideFare'
import { getOfflineFinishIssue } from '@/shared/services/offlineFinishValidation'
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
import { isStartedRide, MISSING_RIDE_MESSAGE } from '@/shared/utils/rideIdentity'
import { rideFinalizationError } from '@/shared/utils/rideFinalizationError'
import { paymentMethodLabel, ridePaymentPresentation } from '@/shared/utils/ridePaymentPresentation'
import RidePaymentSummary from '@/driver/components/RidePaymentSummary'

const formatCurrency = (amount) => new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
}).format(Number(amount) || 0)

const FINALIZE_PREVIEW_TIMEOUT_MS = 5000

const isNetworkError = (error) => (
    !error?.response && ((typeof navigator !== 'undefined' && !navigator.onLine)
    || error?.message === 'Network Error'
    || (!error?.response && ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'].includes(error?.code))
    // Teto de tempo estourado ou GPS que não sincronizou: os dois são falta de
    // conectividade, não erro de regra do servidor. Precisam cair no mesmo caminho
    // (guardar a finalização na fila) em vez de virar um toast que perde a corrida.
    || error?.isConnectivityIssue === true)
)

const FinishRide = (props) => {
    const [ended, setEnded] = useState(false)
    const [paymentConfirmed, setPaymentConfirmed] = useState(false)
    // Finalização salva offline pode ter um cálculo local, mas preço e pagamento
    // ainda não estão confirmados pelo servidor.
    const [pendingFinalizationSync, setPendingFinalizationSync] = useState(false)
    const [pendingPaymentSync, setPendingPaymentSync] = useState(false)
    const [endedRide, setEndedRide] = useState(null)
    // Finalização offline não passa pela mutation, então precisa do próprio estado de
    // carregamento — sem ele o botão não trava e um toque duplo enfileira duas vezes.
    const [queueingOffline, setQueueingOffline] = useState(false)
    const [finishIssue, setFinishIssue] = useState(null)
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

    const chargeRide = endedRide || props.ride
    const payment = ridePaymentPresentation(chargeRide, { pendingFinalization: pendingFinalizationSync })
    const offlineFareUnavailable = previewFare?.offline && previewFare?.amount == null

    const queryClient = useQueryClient();

    // Liquidação contábil não comprova dinheiro/Pix recebido. O resumo permanece
    // visível até o motorista escolher sair ou avaliar, sem redirecionamento por timer.
    function handlePaymentSettled() {
        setPaymentConfirmed(true)
        queryClient.invalidateQueries({ queryKey: ['captainWallet'] })
        queryClient.invalidateQueries({ queryKey: ['captainTransactions'] })
        queryClient.invalidateQueries({ queryKey: ['captainHistory'] })
    }

    const endRideMutation = useMutation({
        mutationFn: async (finishPayload) => {
            if (!isStartedRide(props.ride) || finishPayload?.rideId !== props.ride._id) {
                throw new Error(MISSING_RIDE_MESSAGE)
            }
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
                api.post(`${import.meta.env.VITE_BASE_URL}/rides/end-ride`, finishPayload, {
                    headers: {
                        Authorization: `Bearer ${getAccessToken('captain')}`
                    }
                }),
            )
            if (response.data?._id !== finishPayload.rideId || response.data?.status !== 'finished') {
                const error = new Error('Resposta de finalização sem confirmação da corrida.')
                error.isConnectivityIssue = true
                throw error
            }
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
            // Finalizar já resolve tudo: o backend liquida comissão e repasse dentro do
            // próprio end-ride (2026-08-16). Dinheiro e Pix vão direto pra mão do
            // motorista, então não há nada a confirmar num segundo toque.
            //
            // A tela de "Confirmar Pagamento" sobrevive só como socorro real: quando a
            // liquidação do servidor não fechou (finalizationState 'retry_required', sem
            // paymentStatus 'paid'). Aí o botão ainda decide alguma coisa — nos outros
            // casos ele só pedia um toque cerimonial.
            if (data?.paymentStatus === 'paid') {
                handlePaymentSettled()
            }
        },
        onError: async (err, finishPayload) => {
            console.error('End ride error:', err)
            if (isNetworkError(err)) {
                await queueFinalizationOffline(finishPayload)
                return
            }
            addToast(rideFinalizationError(err), 'error')
            if (typeof navigator === 'undefined' || navigator.onLine) {
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
            }
        }
    })

    // Guarda a finalização pra sincronizar depois e libera o motorista pra cobrar.
    // Vive fora do onError porque agora também é chamada ANTES de tentar a rede,
    // quando o app já sabe que está sem sinal.
    async function queueFinalizationOffline(finishPayload) {
        try {
            if (!isStartedRide(props.ride) || finishPayload?.rideId !== props.ride._id) {
                setFinishIssue(MISSING_RIDE_MESSAGE)
                return
            }
            const issue = await withHardTimeout(getOfflineFinishIssue(props.ride, finishPayload))
            if (issue) {
                setPreviewFare(null)
                setFinishIssue(issue.message)
                return
            }
            await enqueueOfflineAction({
                type: 'end-ride',
                rideId: props.ride._id,
                payload: finishPayload,
                // Resumo mínimo para a pendência sobreviver ao fechamento do app.
                // Não armazena identidade do passageiro nem preço como se fosse confirmado.
                rideSnapshot: {
                    pickup: props.ride.pickup, destination: props.ride.destination,
                    source: props.ride.source, createdAt: props.ride.createdAt,
                    paymentMethod: props.ride.paymentMethod,
                },
            })
            // A prévia não pode impedir a persistência do trabalho já realizado.
            const localPreview = previewFare?.offline && previewFare?.amount != null
                ? previewFare
                : await buildOfflineFinishPreview(props.ride, finishPayload.finishTimestamp).catch(() => null)
            setEnded(true)
            setEndedRide(localPreview?.amount > 0
                ? {
                    ...props.ride,
                    finalPrice: localPreview.amount,
                    actualDistance: localPreview.actualDistance,
                    actualTime: localPreview.elapsedSeconds,
                    fareBreakdown: localPreview.fareBreakdown,
                }
                : { ...props.ride, finalPrice: null })
            // Espelha a finalização no RideContext, igual ao que o caminho online faz no
            // onSuccess. Sem isto o contexto seguia com a corrida em 'started': o guarda de
            // finalização pendente impede o SERVIDOR de reabrir a corrida quando a internet
            // volta, mas não conserta um estado LOCAL que nunca avançou — e era esse estado
            // parado que fazia a corrida "voltar a ficar ativa" na Home do motorista.
            //
            // Vale mesmo sem valor calculado: a corrida foi fechada e enfileirada de
            // qualquer jeito, só o preço é que fica para o servidor confirmar.
            setCaptainRide({
                ...props.ride,
                status: 'finished',
                ...(localPreview?.amount > 0 ? {
                    finalPrice: localPreview.amount,
                    actualDistance: localPreview.actualDistance,
                    actualTime: localPreview.elapsedSeconds,
                    fareBreakdown: localPreview.fareBreakdown,
                } : {}),
            })
            setPendingFinalizationSync(true)
            queryClient.invalidateQueries({ queryKey: ['captainHistory'] })
            // Dinheiro e Pix são pagos em mãos. A liquidação no servidor só ocorre
            // depois da sincronização; não criar uma ação de pagamento redundante.
            // Sem isto o caminho offline caía na tela "Confirmar Pagamento" e exigia um
            // toque em "Pagamento Recebido" que não decide mais nada.
            addToast(
                localPreview?.amount > 0
                    ? 'Finalização salva no aparelho. O valor calculado ainda aguarda confirmação do servidor.'
                    : 'Finalização pendente. Aguarde o valor final antes de cobrar o passageiro.',
                'warning',
            )
        } catch (queueError) {
            console.error('Could not queue end ride action:', queueError)
            addToast('Não foi possível guardar a finalização para sincronizar. Tente novamente com internet.', 'error')
        }
    }

    function captureFinishPayload() {
        const finishTimestamp = Date.now()
        return {
            rideId: props.ride._id,
            finishTimestamp,
            ...(userLocation?.lat != null && userLocation?.lng != null ? {
                finishLat: userLocation.lat,
                finishLng: userLocation.lng,
                finishAccuracy: userLocation.accuracy ?? null,
                finishLocationTimestamp: userLocation.timestamp ?? finishTimestamp,
            } : {}),
        }
    }

    async function endRide() {
        if (!isStartedRide(props.ride)) {
            setFinishIssue(MISSING_RIDE_MESSAGE)
            return
        }
        // O mesmo snapshot segue no POST e na fila se houver falha ou timeout.
        const finishPayload = captureFinishPayload()
        // Sem sinal conhecido: guarda direto, sem tentar a rede. Antes a fila só era
        // alimentada pelo onError, então o app precisava que a requisição FALHASSE pra
        // guardar a finalização — e sem conectividade ela não falha, fica pendurada.
        // O motorista via o botão girando pra sempre e, se fechasse o app, perdia a
        // corrida. O replay drena o GPS antes de reenviar, então pular o flush aqui é
        // seguro (ver replayOfflineActions em offlineQueue.js).
        if (previewFare?.offline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
            if (queueingOffline) return
            setQueueingOffline(true)
            try {
                await queueFinalizationOffline(finishPayload)
            } finally {
                setQueueingOffline(false)
            }
            return
        }
        endRideMutation.mutate(finishPayload);
    }

    async function showOfflinePreview() {
        try {
            const payload = captureFinishPayload()
            const issue = await withHardTimeout(getOfflineFinishIssue(props.ride, payload))
            if (issue) {
                setPreviewFare(null)
                setFinishIssue(issue.message)
                return
            }
            const local = await buildOfflineFinishPreview(props.ride)
            setPreviewFare(local?.amount > 0 ? local : { offline: true, amount: null })
        } catch {
            setFinishIssue('Não foi possível verificar os dados locais da corrida. Tente novamente. A corrida não foi encerrada.')
        }
    }

    // Busca /rides/captain-current, que agora devolve liveFare com a mesma conta
    // (distância já registrada + tempo recalculado na hora) que a finalização real vai
    // usar. Sem liveFare utilizável (corrida presencial sem destino/distância ainda,
    // ou a busca falhou) segue direto pra finalização — ela já valida e recalcula
    // corretamente sozinha, então não travar o motorista numa prévia impossível.
    async function handleFinalizeClick() {
        if (!isStartedRide(props.ride)) {
            setFinishIssue(MISSING_RIDE_MESSAGE)
            return
        }
        setFinishIssue(null)
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setPreviewLoading(true)
            try {
                await showOfflinePreview()
            } finally {
                setPreviewLoading(false)
            }
            return
        }

        setPreviewLoading(true)
        try {
            const fresh = await withHardTimeout(syncCaptainRide(), FINALIZE_PREVIEW_TIMEOUT_MS)
            if (fresh?.liveFare?.amount > 0) {
                setPreviewFare(fresh.liveFare)
            } else {
                endRide()
            }
        } catch (err) {
            console.error('Erro buscando prévia do valor final:', err)
            await showOfflinePreview()
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
        onSuccess: (data) => {
            if (data?._id === props.ride._id) setEndedRide(data)
            handlePaymentSettled()
        },
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
        } catch (queueError) {
            console.error('Could not queue payment confirmation:', queueError)
            addToast('Não foi possível guardar a confirmação de pagamento. Tente novamente com internet.', 'error')
        }
    }

    async function confirmPayment() {
        if (!payment.direct || payment.collectionAmount == null || pendingFinalizationSync
            || paymentConfirmed || pendingPaymentSync || confirmPaymentMutation.isPending || queueingOffline) return
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

    const onBusyChange = props.onBusyChange
    const onFinishedChange = props.onFinishedChange
    useEffect(() => { onFinishedChange?.(ended) }, [ended, onFinishedChange])
    useEffect(() => {
        onBusyChange?.(previewLoading || queueingOffline || endRideMutation.isPending || confirmPaymentMutation.isPending || submittingRating)
    }, [previewLoading, queueingOffline, endRideMutation.isPending, confirmPaymentMutation.isPending, submittingRating, onBusyChange])
    useEffect(() => () => onBusyChange?.(false), [onBusyChange])

    if (!ended && !isStartedRide(props.ride)) {
        return <div className="space-y-4">
            <p role="alert">{MISSING_RIDE_MESSAGE}</p>
            <Button onClick={() => navigate('/captain/rides', { replace: true })}>Abrir Corridas</Button>
        </div>
    }

    return (
        <div className="max-h-[calc(100dvh-7rem)] overflow-y-auto overscroll-contain pb-2">
            {finishIssue && <p role="alert" className="bg-danger-50 text-danger-600 rounded-panel p-3 mb-3 text-sm">{finishIssue}</p>}
            {!ended ? previewFare ? (
                <>
                    <h3 className='text-base font-semibold mb-2.5 text-ink-900'>
                        {offlineFareUnavailable ? 'Finalizar sem internet' : previewFare.offline ? 'Conferir estimativa no aparelho' : 'Confirmar valor final'}
                    </h3>
                    <p className='text-xs text-ink-600 mb-3'>
                        {offlineFareUnavailable
                            ? 'O pedido de finalização será guardado no celular e enviado quando a conexão voltar. Aguarde a confirmação no sistema.'
                            : previewFare?.offline
                            ? 'Sem internet neste destino. Este valor foi calculado no celular e ainda não foi confirmado pelo servidor.'
                            : 'Valor calculado agora, com a distância e o tempo reais desta corrida.'}
                    </p>

                    <p className="text-xs text-ink-700 mb-3">{payment.instruction}</p>

                    {!offlineFareUnavailable && (
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
                    )}

                    {offlineFareUnavailable ? (
                        <div className='bg-danger-50 rounded-panel p-4 border border-danger-500/20 mb-5 text-center'>
                            <p className='text-sm font-semibold text-danger-600'>Não cobre o passageiro até o valor final aparecer no sistema.</p>
                        </div>
                    ) : (
                        <div className='bg-surface-alt rounded-panel p-5 border border-line mb-5 text-center'>
                            <p className='text-ink-600 text-sm mb-1'>{previewFare.offline ? 'Estimativa total no aparelho' : 'Valor total da corrida'}</p>
                            <p className='text-brand-600 text-3xl font-black'>{formatBRL(previewFare.amount)}</p>
                        </div>
                    )}

                    <p className='text-xs text-ink-500 text-center mb-4'>
                        {offlineFareUnavailable
                            ? 'A finalização tentará sincronizar automaticamente quando o sinal voltar.'
                            : previewFare?.offline
                            ? 'A finalização será enviada quando o sinal voltar. O servidor validará os dados e o valor poderá ser ajustado.'
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
                            {offlineFareUnavailable ? 'Finalizar sem internet' : 'Confirmar e finalizar'}
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
                                · {paymentMethodLabel(props.ride?.paymentMethod)}
                            </span>
                        </p>
                    </div>

                    <Button
                        onClick={handleFinalizeClick}
                        loading={previewLoading || endRideMutation.isPending || queueingOffline}
                        className="mt-3 !min-h-[44px] !text-sm"
                    >
                        Finalizar corrida
                    </Button>
                </>
            ) : pendingFinalizationSync ? (
                <div className="flex flex-col items-center py-6 gap-4">
                    <h3 className="text-xl font-bold text-amber-800">Finalização pendente</h3>
                    <RidePaymentSummary ride={chargeRide} pendingFinalization />
                    {payment.total == null && <p className="text-sm font-semibold text-danger-600">Não cobre o passageiro até receber o valor final.</p>}
                    <Button onClick={() => navigate('/captain/rides')}>Acompanhar em Corridas</Button>
                    <Button variant="secondary" onClick={() => navigate('/captain-home')}>Voltar para o início</Button>
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
            ) : (
                <div className="flex flex-col items-center py-6 gap-4">
                    <h3 className="text-xl font-bold text-ink-900">Serviço concluído</h3>
                    <RidePaymentSummary ride={chargeRide} pendingPayment={pendingPaymentSync} />
                    {payment.direct && !paymentConfirmed && !pendingPaymentSync && (
                        <>
                            <p className="text-sm text-ink-700">O registro financeiro ainda está pendente. Confirme abaixo somente se já recebeu o valor devido.</p>
                            <Button onClick={confirmPayment}
                                disabled={payment.collectionAmount == null}
                                loading={confirmPaymentMutation.isPending || queueingOffline}>
                                Pagamento Recebido
                            </Button>
                        </>
                    )}
                    <Button onClick={() => navigate('/captain-home')}>Voltar para o início</Button>
                    <Button variant="secondary" onClick={() => navigate('/captain/rides')}>Abrir Corridas</Button>
                    {props.ride?.user && <Button variant="ghost" onClick={() => setShowRating(true)}>Avaliar passageiro</Button>}
                </div>
            )}
        </div>
    )
}

export default FinishRide
