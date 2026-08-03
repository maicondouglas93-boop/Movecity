import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { enqueueOfflineAction } from '@/services/offlineQueue'
import { getAccessToken } from '@/services/session'
import * as Sentry from '@sentry/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Avatar from '@/shared/components/Avatar'
import Button from '@/shared/components/ui/Button'

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

    // Antes de finalizar, mostra a estimativa (ainda não existe valor final). Depois de
    // finalizar, usa a corrida real devolvida pelo servidor.
    const chargeRide = endedRide || props.ride
    const finalAmount = endedRide?.finalPrice ?? props.ride?.fare ?? 0
    const commissionAmount = chargeRide?.commissionAmount || 0
    const driverKeeps = finalAmount - commissionAmount

    const queryClient = useQueryClient();

    const endRideMutation = useMutation({
        mutationFn: async () => {
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/end-ride`, {
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
            queryClient.invalidateQueries({ queryKey: ['captainHistory'] })
        },
        onError: (err) => {
            console.error('End ride error:', err)
            if (!navigator.onLine || err.message === 'Network Error') {
                enqueueOfflineAction({
                    type: 'end-ride',
                    rideId: props.ride._id,
                    payload: { rideId: props.ride._id }
                }).catch(e => console.error(e));
                setEnded(true); // Optimistic — sem valor final do servidor ainda, usa a estimativa
                setEndedRide(props.ride);
            } else {
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
            }
        }
    })

    async function endRide() {
        endRideMutation.mutate();
    }

    const confirmPaymentMutation = useMutation({
        mutationFn: async () => {
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/confirm-payment`, {
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
            setTimeout(() => setShowRating(true), 1200)
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
            await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/captain-review`, {
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
                    <h3 className='text-2xl font-semibold mb-5 text-ink-900'>Finalizar esta Corrida</h3>
                    <div className='flex items-center justify-between p-4 border-2 border-brand-100 bg-brand-50 rounded-panel mt-4'>
                        <div className='flex items-center gap-3 '>
                            <Avatar firstname={props.ride?.user?.fullname?.firstname} lastname={props.ride?.user?.fullname?.lastname} />
                            <h2 className='text-lg font-bold text-ink-900'>{props.ride?.user?.fullname?.firstname} {props.ride?.user?.fullname?.lastname}</h2>
                        </div>
                        <h5 className='text-lg font-bold text-ink-900'>{props.ride?.estimatedDistance ? (props.ride.estimatedDistance / 1000).toFixed(1) + ' KM' : '—'}</h5>
                    </div>
                    <div className='flex gap-2 justify-between flex-col items-center'>
                        <div className='w-full mt-5'>
                            <div className='flex items-center gap-5 p-3 border-b-2 border-line'>
                                <i className="ri-map-pin-user-fill text-brand-500"></i>
                                <div>
                                    <h3 className='text-lg font-medium text-ink-900'>{props.ride?.pickup?.split(',')[0]}</h3>
                                    <p className='text-sm -mt-1 text-ink-600'>{props.ride?.pickup}</p>
                                </div>
                            </div>
                            <div className='flex items-center gap-5 p-3 border-b-2 border-line'>
                                <i className="text-lg ri-map-pin-2-fill text-danger-500"></i>
                                <div>
                                    <h3 className='text-lg font-medium text-ink-900'>{props.ride?.destination?.split(',')[0]}</h3>
                                    <p className='text-sm -mt-1 text-ink-600'>{props.ride?.destination}</p>
                                </div>
                            </div>
                            <div className='flex items-center gap-5 p-3'>
                                <i className="ri-currency-line text-brand-500"></i>
                                <div>
                                    <h3 className='text-lg font-medium text-ink-900'>R$ {props.ride?.fare}</h3>
                                    <p className='text-sm -mt-1 text-ink-600'>{props.ride?.paymentMethod === 'pix' ? 'Pix' : props.ride?.paymentMethod === 'carteira' ? 'Carteira' : props.ride?.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'}</p>
                                </div>
                            </div>
                        </div>

                        <div className='mt-6 w-full'>
                            <Button
                                onClick={endRide}
                                loading={endRideMutation.isPending}
                                className="mt-5"
                            >
                                Finalizar Corrida
                            </Button>
                        </div>
                    </div>
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
                            <h3 className='text-xl font-bold text-amber-700'>Pagamento registrado</h3>
                            <p className='text-ink-600 text-center'>Sem conexão no momento — vamos confirmar com o servidor assim que a internet voltar. Comissão prevista de R$ {commissionAmount.toFixed(2)}.</p>
                            <p className='text-ink-600 text-sm'>Redirecionando...</p>
                        </>
                    ) : (
                        <>
                            <h3 className='text-xl font-bold text-brand-700'>Pagamento Confirmado!</h3>
                            <p className='text-ink-600 text-center'>Comissão de R$ {commissionAmount.toFixed(2)} descontada dos créditos.</p>
                        </>
                    )}
                </div>
            ) : (
                <>
                    <h3 className='text-2xl font-semibold mb-3 text-ink-900'>Confirmar Pagamento</h3>
                    <p className='text-ink-600 mb-5'>Receba o dinheiro do passageiro e confirme abaixo.</p>

                    {/* Payment Summary */}
                    <div className='bg-surface-alt rounded-panel p-5 border border-line mb-5'>
                        <div className='flex justify-between items-center mb-3 pb-3 border-b border-line'>
                            <span className='text-ink-600'>Valor final da corrida</span>
                            <span className='text-xl font-bold text-ink-900'>R$ {finalAmount.toFixed(2)}</span>
                        </div>
                        <div className='flex justify-between items-center mb-3 pb-3 border-b border-line'>
                            <span className='text-ink-600'>Comissão ({props.ride?.commissionPercent ?? '—'}%)</span>
                            <span className='text-danger-500 font-semibold'>- R$ {commissionAmount.toFixed(2)}</span>
                        </div>
                        <div className='flex justify-between items-center'>
                            <span className='text-ink-900 font-semibold'>Você fica com (dinheiro)</span>
                            <span className='text-brand-600 text-xl font-bold'>R$ {driverKeeps.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className='bg-surface-alt border border-line rounded-panel p-3 mb-5 flex items-start gap-2'>
                        <i className="ri-information-line text-ink-400 mt-0.5"></i>
                        <p className='text-sm text-ink-600'>A comissão de <strong>R$ {commissionAmount.toFixed(2)}</strong> será descontada dos seus créditos na carteira.</p>
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
