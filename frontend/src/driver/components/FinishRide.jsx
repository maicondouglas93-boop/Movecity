import React, { useState, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import { enqueueOfflineAction } from '@/shared/services/offlineQueue'
import { getAccessToken } from '@/shared/services/session'
import * as Sentry from '@sentry/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '@/shared/components/ui/Button'
import PassengerIdentityCard from '@/shared/components/PassengerIdentityCard'
import { RideContext } from '@/shared/contexts/RideContext'
import { useToast } from '@/shared/contexts/ToastContext'

const FinishRide = (props) => {
    const [loading, setLoading] = useState(false)
    const [ended, setEnded] = useState(false)
    const [paymentConfirmed, setPaymentConfirmed] = useState(false)
    // true quando "pago"/"finalizado" é otimista (sem rede) — ainda não confirmado pelo
    // servidor. A fila offline (P1.2 da auditoria de concorrência) avisa por toast quando
    // sincronizar de verdade; aqui só evitamos comemorar "Pagamento Confirmado!" antes da hora.
    const [pendingSync, setPendingSync] = useState(false)
    // Auditoria de UX do motorista (2026-08-02, §2.3): a corrida devolvida pelo end-ride
    // tem o valor FINAL (finalPrice + taxa de espera, recalculado com distância/tempo
    // reais) — diferente de props.ride.fare, que é só a estimativa de antes da corrida
    // começar. Cobrar do passageiro com base na estimativa fazia o motorista receber a
    // menos sempre que a corrida real foi mais longa/demorada que a estimada.
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

    // Valor que o passageiro deve pagar (bruto operacional).
    // driverAmount (líquido) fica para ganhos — não misturar na cobrança em espécie.
    const chargeRide = endedRide || props.ride
    const passengerAmount = Number(
        chargeRide?.finalPrice
        ?? chargeRide?.fare
        ?? 0
    ) || 0

    const queryClient = useQueryClient();

    const endRideMutation = useMutation({
        mutationFn: async () => {
            const response = await api.post(`${import.meta.env.VITE_BASE_URL}/rides/end-ride`, {
                rideId: props.ride._id
            }, {
                headers: {
                    Authorization: `Bearer ${getAccessToken('captain')}`
                }
            })
            return response.data;
        },
        onSuccess: (data) => {
            setEnded(true)
            setEndedRide(data)
            // Fase A da experiência de corrida ativa (2026-08-03): espelha a corrida
            // finalizada no RideContext — sem isso, ele ficava com status 'started'
            // obsoleto e a Home mostraria "corrida em andamento" pra uma corrida que
            // já acabou (até a próxima sincronização com o backend).
            setCaptainRide(data)
            queryClient.invalidateQueries({ queryKey: ['captainHistory'] })
        },
        onError: (err) => {
            console.error('End ride error:', err)
            // Auditoria A5: presencial com destino pendente NÃO pode finalizar offline —
            // o preço depende do GPS/rota no backend; otimismo com fare=0 seria fraude UX.
            const presentialPending = props.ride?.source === 'driver_initiated'
                && (props.ride?.destinationPending || !props.ride?.destination)
            if ((!navigator.onLine || err.message === 'Network Error') && !presentialPending) {
                enqueueOfflineAction({
                    type: 'end-ride',
                    rideId: props.ride._id,
                    payload: { rideId: props.ride._id }
                }).catch(e => console.error(e));
                setEnded(true); // Optimistic — sem valor final do servidor ainda, usa a estimativa
                setEndedRide(props.ride);
            } else {
                addToast(err.response?.data?.message || 'Não foi possível finalizar a corrida.', 'error')
                if (navigator.onLine) {
                    Sentry.captureException(err, { tags: { issue: 'api_error' } });
                }
            }
        }
    })

    async function endRide() {
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
                setTimeout(() => setShowRating(true), 1200)
            } else {
                setTimeout(() => {
                    setCaptainRide(null)
                    navigate('/captain-home')
                }, 1500)
            }
        },
        onError: (err) => {
            console.error('Confirm payment error:', err)
            if (!navigator.onLine || err.message === 'Network Error') {
                enqueueOfflineAction({
                    type: 'confirm-payment',
                    rideId: props.ride._id,
                    payload: { rideId: props.ride._id }
                }).catch(e => console.error(e));
                setPaymentConfirmed(true)
                setPendingSync(true)
                setCaptainRide(null)
                setTimeout(() => navigate('/captain-home'), 2500) // Optimistic
            } else {
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
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
                                    : `R$ ${props.ride?.finalPrice ?? props.ride?.fare ?? '—'}`}
                            </span>
                            <span className="text-ink-500">
                                · {props.ride?.paymentMethod === 'pix' ? 'Pix' : props.ride?.paymentMethod === 'carteira' ? 'Carteira' : props.ride?.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'}
                            </span>
                        </p>
                    </div>

                    <Button
                        onClick={endRide}
                        loading={endRideMutation.isPending}
                        className="mt-3 !min-h-[44px] !text-sm"
                    >
                        Finalizar corrida
                    </Button>
                </>
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
                    <div className={pendingSync ? 'bg-amber-100 rounded-full p-4' : 'bg-brand-100 rounded-full p-4'}>
                        <i className={pendingSync ? 'ri-time-line text-amber-600 text-5xl' : 'ri-checkbox-circle-fill text-brand-500 text-5xl'}></i>
                    </div>
                    {pendingSync ? (
                        <>
                            <h3 className='text-xl font-bold text-amber-700'>Serviço concluído</h3>
                            <p className='text-ink-600 text-center'>Sem conexão no momento — vamos confirmar com o servidor assim que a internet voltar.</p>
                            <p className='text-2xl font-bold text-ink-900 mt-2'>Valor do passageiro</p>
                            <p className='text-3xl font-black text-brand-600'>R$ {passengerAmount.toFixed(2)}</p>
                            <p className='text-ink-600 text-sm'>Redirecionando...</p>
                        </>
                    ) : (
                        <>
                            <h3 className='text-xl font-bold text-brand-700'>Serviço concluído</h3>
                            <p className='text-ink-600 text-center'>Pagamento confirmado</p>
                            <p className='text-3xl font-black text-brand-600'>R$ {passengerAmount.toFixed(2)}</p>
                        </>
                    )}
                </div>
            ) : (
                <>
                    <h3 className='text-2xl font-semibold mb-3 text-ink-900'>Confirmar Pagamento</h3>
                    <p className='text-ink-600 mb-5'>Receba o pagamento do passageiro e confirme abaixo.</p>

                    {/* Valor que o passageiro deve pagar (sem comissão/%). */}
                    <div className='bg-surface-alt rounded-panel p-5 border border-line mb-5 text-center'>
                        <p className='text-ink-600 text-sm mb-1'>Cliente deve pagar</p>
                        <p className='text-brand-600 text-3xl font-black'>R$ {passengerAmount.toFixed(2)}</p>
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
