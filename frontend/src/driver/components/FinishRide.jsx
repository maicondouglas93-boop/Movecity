import React, { useState, useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import { enqueueOfflineAction } from '@/shared/services/offlineQueue'
import { getAccessToken } from '@/shared/services/session'
import * as Sentry from '@sentry/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/shared/components/ui/Button'
import AddressAutocomplete from '@/shared/components/ui/AddressAutocomplete'
import PassengerIdentityCard from '@/shared/components/PassengerIdentityCard'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { useToast } from '@/shared/contexts/ToastContext'
import { reverseGeocode, formatAddressWithCoords } from '@/shared/services/mapsApi'
import { formatBRL } from '@/shared/utils/currency'

const formatCurrency = (amount) => new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
}).format(Number(amount) || 0)

const isNetworkError = (error) => (
    (typeof navigator !== 'undefined' && !navigator.onLine)
    || error?.message === 'Network Error'
)

const FinishRide = (props) => {
    const [ended, setEnded] = useState(false)
    const [paymentConfirmed, setPaymentConfirmed] = useState(false)
    // Finalização e pagamento têm confirmações independentes. Uma corrida finalizada
    // offline não tem preço final e não pode seguir para cobrança.
    const [pendingFinalizationSync, setPendingFinalizationSync] = useState(false)
    const [pendingPaymentSync, setPendingPaymentSync] = useState(false)
    const [endedRide, setEndedRide] = useState(null)
    // Auditoria de UX do motorista (2026-08-02, Etapa 7): "o motorista nunca avalia o
    // passageiro, embora reviewApi.js exista no projeto" — o backend já suportava o tipo
    // 'driver_to_passenger' no schema de review, só nunca tinha endpoint pra usá-lo.
    const [showRating, setShowRating] = useState(false)
    const [ratingValue, setRatingValue] = useState(0)
    const [submittingRating, setSubmittingRating] = useState(false)
    const navigate = useNavigate()
    const { setCaptainRide } = useContext(RideContext)
    const { addToast } = useToast()
    const { userLocation } = useContext(LocationContext)

    // Corrida presencial "Definir destino ao finalizar": o backend não conhece o
    // destino ainda (ride.destinationPending) — o motorista precisa digitá-lo aqui
    // antes de finalizar, e o preço real é calculado no servidor a partir da rota
    // origem→este destino (mesmo motor de tarifação de "Informar destino agora").
    const needsDestination = !!(
        props.ride?.destinationPending
        || (props.ride?.source === 'driver_initiated' && !props.ride?.destination)
    )
    const [destinationInput, setDestinationInput] = useState('')
    const [resolvingCurrentLocation, setResolvingCurrentLocation] = useState(false)

    // "Usar minha localização atual": pega o GPS já compartilhado por LocationContext
    // (mesmo watchPosition unificado usado no app inteiro — Capacitor Geolocation no
    // Android, Geolocation API do navegador na PWA) e usa direto como destino, sem o
    // motorista precisar digitar. Embute as coordenadas no texto (mesmo formato do
    // AddressAutocomplete) pra o backend usar a posição exata em vez de geocodificar
    // o endereço de novo.
    async function useCurrentLocationAsDestination() {
        if (userLocation?.lat == null || userLocation?.lng == null) {
            addToast('Aguardando GPS. Ative a localização e tente novamente.', 'error')
            return
        }
        setResolvingCurrentLocation(true)
        try {
            let address = ''
            try {
                const result = await reverseGeocode(userLocation.lat, userLocation.lng)
                address = result?.address || ''
            } catch (err) {
                console.error('Reverse geocode error:', err)
            }
            if (!address) {
                address = `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`
            }
            setDestinationInput(formatAddressWithCoords({ address, lat: userLocation.lat, lng: userLocation.lng }))
        } finally {
            setResolvingCurrentLocation(false)
        }
    }

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

    const queryClient = useQueryClient();

    const endRideMutation = useMutation({
        mutationFn: async () => {
            const response = await api.post(`${import.meta.env.VITE_BASE_URL}/rides/end-ride`, {
                rideId: props.ride._id,
                ...(needsDestination ? { destination: destinationInput.trim() } : {}),
            }, {
                headers: {
                    Authorization: `Bearer ${getAccessToken('captain')}`
                }
            })
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
        },
        onError: async (err) => {
            console.error('End ride error:', err)
            const presentialPending = props.ride?.source === 'driver_initiated'
                && (props.ride?.destinationPending || !props.ride?.destination)
            if (isNetworkError(err) && !presentialPending) {
                try {
                    await enqueueOfflineAction({
                        type: 'end-ride',
                        rideId: props.ride._id,
                        payload: { rideId: props.ride._id }
                    })
                    setEnded(true)
                    setEndedRide(null)
                    setPendingFinalizationSync(true)
                    addToast('Finalização pendente. Aguarde o valor final antes de cobrar o passageiro.', 'warning')
                } catch (queueError) {
                    console.error('Could not queue end ride action:', queueError)
                    addToast('Não foi possível guardar a finalização para sincronizar. Tente novamente com internet.', 'error')
                }
            } else {
                addToast(err.response?.data?.message || 'Não foi possível finalizar a corrida.', 'error')
                if (typeof navigator === 'undefined' || navigator.onLine) {
                    Sentry.captureException(err, { tags: { issue: 'api_error' } });
                }
            }
        }
    })

    async function endRide() {
        if (needsDestination && destinationInput.trim().length < 3) {
            addToast('Informe o endereço onde a corrida terminou.', 'error')
            return
        }
        endRideMutation.mutate();
    }

    const confirmPaymentMutation = useMutation({
        mutationFn: async () => {
            const response = await api.post(`${import.meta.env.VITE_BASE_URL}/rides/confirm-payment`, {
                rideId: props.ride._id
            }, {
                headers: {
                    Authorization: `Bearer ${getAccessToken('captain')}`
                }
            })
            return response.data;
        },
        onSuccess: () => {
            setPaymentConfirmed(true)
            queryClient.invalidateQueries({ queryKey: ['captainWallet'] })
            queryClient.invalidateQueries({ queryKey: ['captainTransactions'] })
            queryClient.invalidateQueries({ queryKey: ['captainHistory'] })
            // Breve confirmação visual, depois pede a avaliação do passageiro em vez de
            // já mandar pra Home — só faz sentido pedir quando o pagamento foi
            // confirmado de verdade (não no caminho offline/pendingSync abaixo).
            // Presencial sem passageiro vinculado: pula avaliação.
            if (props.ride?.user) {
                scheduleTimer(() => setShowRating(true), 1200)
            } else {
                scheduleTimer(() => {
                    setCaptainRide(null)
                    navigate('/captain-home')
                }, 1500)
            }
        },
        onError: async (err) => {
            console.error('Confirm payment error:', err)
            if (isNetworkError(err)) {
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
            } else {
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
                addToast(err.response?.data?.message || 'Não foi possível confirmar o pagamento.', 'error')
            }
        }
    })

    async function confirmPayment() {
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
            {!ended ? (
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

                    {needsDestination && (
                        <div className="mt-3">
                            <AddressAutocomplete
                                id="finish-ride-destination"
                                label="Onde a corrida terminou?"
                                value={destinationInput}
                                onChange={setDestinationInput}
                                onResolved={setDestinationInput}
                                placeholder="Digite o endereço de destino"
                                biasLocation={userLocation}
                                disabled={endRideMutation.isPending}
                                icon="ri-map-pin-2-fill"
                                inputClassName="w-full min-h-[44px] pl-10 pr-10 rounded-panel border border-line bg-surface text-sm text-ink-900 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                            />
                            <button
                                type="button"
                                onClick={useCurrentLocationAsDestination}
                                disabled={endRideMutation.isPending || resolvingCurrentLocation || userLocation?.lat == null}
                                className="mt-2 w-full flex items-center justify-center gap-1.5 min-h-[40px] rounded-panel border border-line bg-surface-alt text-sm font-medium text-brand-700 active:scale-[0.99] transition-transform disabled:opacity-50"
                            >
                                <i className={resolvingCurrentLocation ? 'ri-loader-4-line animate-spin' : 'ri-crosshair-2-line'} aria-hidden="true" />
                                {resolvingCurrentLocation ? 'Localizando…' : 'Usar minha localização atual'}
                            </button>
                            <p className="text-xs text-ink-400 mt-1">
                                O preço é calculado pela rota real entre o embarque e este destino.
                            </p>
                        </div>
                    )}

                    <Button
                        onClick={endRide}
                        loading={endRideMutation.isPending}
                        disabled={needsDestination && destinationInput.trim().length < 3}
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
                    <h3 className='text-xl font-bold text-amber-700 text-center'>Finalização aguardando conexão</h3>
                    <p className='text-ink-600 text-center'>A corrida foi guardada para sincronizar. O valor final será calculado pelo servidor quando a internet voltar.</p>
                    <p className='text-sm font-semibold text-danger-600 text-center'>Não cobre o passageiro até receber o valor final.</p>
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

                    {/* Valor que o passageiro deve pagar (sem comissão/%). */}
                    <div className='bg-surface-alt rounded-panel p-5 border border-line mb-5 text-center'>
                        <p className='text-ink-600 text-sm mb-1'>Cliente deve pagar</p>
                        <p className='text-brand-600 text-3xl font-black'>{formatBRL(passengerAmount)}</p>
                    </div>

                    <div className='bg-surface-alt border border-line rounded-panel p-3 mb-5 flex items-start gap-2'>
                        <i className="ri-information-line text-ink-400 mt-0.5"></i>
                        <p className='text-sm text-ink-600'>Cliente paga direto a você. Confirme quando o pagamento for recebido.</p>
                    </div>

                    <Button onClick={confirmPayment} loading={confirmPaymentMutation.isPending}>
                        <i className="ri-hand-coin-fill text-xl"></i>
                        Pagamento Recebido
                    </Button>
                </>
            )}
        </div>
    )
}

export default FinishRide
