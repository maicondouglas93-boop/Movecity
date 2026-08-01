import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { enqueueOfflineAction } from '@/services/offlineQueue'
import * as Sentry from '@sentry/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Avatar from '@/shared/components/Avatar'

const FinishRide = (props) => {
    const [loading, setLoading] = useState(false)
    const [ended, setEnded] = useState(false)
    const [paymentConfirmed, setPaymentConfirmed] = useState(false)
    // true quando "pago"/"finalizado" é otimista (sem rede) — ainda não confirmado pelo
    // servidor. A fila offline (P1.2 da auditoria de concorrência) avisa por toast quando
    // sincronizar de verdade; aqui só evitamos comemorar "Pagamento Confirmado!" antes da hora.
    const [pendingSync, setPendingSync] = useState(false)
    const navigate = useNavigate()

    const commissionAmount = props.ride?.commissionAmount || 0
    const driverKeeps = (props.ride?.fare || 0) - commissionAmount

    const queryClient = useQueryClient();

    const endRideMutation = useMutation({
        mutationFn: async () => {
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/end-ride`, {
                rideId: props.ride._id
            }, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('captain-token')}`
                }
            })
            return response.data;
        },
        onSuccess: () => {
            setEnded(true)
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
                setEnded(true); // Optimistic
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
                    Authorization: `Bearer ${localStorage.getItem('captain-token')}`
                }
            })
            return response.data;
        },
        onSuccess: () => {
            setPaymentConfirmed(true)
            queryClient.invalidateQueries({ queryKey: ['captainWallet'] })
            queryClient.invalidateQueries({ queryKey: ['captainTransactions'] })
            queryClient.invalidateQueries({ queryKey: ['captainHistory'] })
            setTimeout(() => navigate('/captain-home'), 2500)
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

    return (
        <div>
            <h5 className='p-1 text-center w-[93%] absolute top-0' onClick={() => {
                props.setFinishRidePanel(false)
            }}><i className="text-3xl text-gray-200 ri-arrow-down-wide-line"></i></h5>

            {!ended ? (
                <>
                    <h3 className='text-2xl font-semibold mb-5 text-gray-800'>Finalizar esta Corrida</h3>
                    <div className='flex items-center justify-between p-4 border-2 border-green-200 bg-green-50 rounded-lg mt-4'>
                        <div className='flex items-center gap-3 '>
                            <Avatar firstname={props.ride?.user?.fullname?.firstname} lastname={props.ride?.user?.fullname?.lastname} />
                            <h2 className='text-lg font-bold text-gray-800'>{props.ride?.user?.fullname?.firstname} {props.ride?.user?.fullname?.lastname}</h2>
                        </div>
                        <h5 className='text-lg font-bold text-gray-800'>{props.ride?.estimatedDistance ? (props.ride.estimatedDistance / 1000).toFixed(1) + ' KM' : '—'}</h5>
                    </div>
                    <div className='flex gap-2 justify-between flex-col items-center'>
                        <div className='w-full mt-5'>
                            <div className='flex items-center gap-5 p-3 border-b-2'>
                                <i className="ri-map-pin-user-fill text-green-500"></i>
                                <div>
                                    <h3 className='text-lg font-medium text-gray-800'>{props.ride?.pickup?.split(',')[0]}</h3>
                                    <p className='text-sm -mt-1 text-gray-500'>{props.ride?.pickup}</p>
                                </div>
                            </div>
                            <div className='flex items-center gap-5 p-3 border-b-2'>
                                <i className="text-lg ri-map-pin-2-fill text-red-500"></i>
                                <div>
                                    <h3 className='text-lg font-medium text-gray-800'>{props.ride?.destination?.split(',')[0]}</h3>
                                    <p className='text-sm -mt-1 text-gray-500'>{props.ride?.destination}</p>
                                </div>
                            </div>
                            <div className='flex items-center gap-5 p-3'>
                                <i className="ri-currency-line text-green-500"></i>
                                <div>
                                    <h3 className='text-lg font-medium text-gray-800'>R$ {props.ride?.fare}</h3>
                                    <p className='text-sm -mt-1 text-gray-500'>{props.ride?.paymentMethod === 'pix' ? 'Pix' : props.ride?.paymentMethod === 'carteira' ? 'Carteira' : props.ride?.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'}</p>
                                </div>
                            </div>
                        </div>

                        <div className='mt-6 w-full'>
                            <button
                                onClick={endRide}
                                disabled={endRideMutation.isPending}
                                className='w-full mt-5 flex text-lg justify-center bg-green-500 hover:bg-green-600 disabled:bg-green-400 text-white font-bold p-3 rounded-xl transition-all shadow-lg shadow-green-500/20'
                            >
                                {endRideMutation.isPending ? (
                                    <span className='flex items-center gap-2'>
                                        <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                        </svg>
                                        Finalizando...
                                    </span>
                                ) : 'Finalizar Corrida'}
                            </button>
                        </div>
                    </div>
                </>
            ) : paymentConfirmed ? (
                <div className='flex flex-col items-center justify-center py-10 gap-4'>
                    <div className={pendingSync ? 'bg-yellow-100 rounded-full p-4' : 'bg-green-100 rounded-full p-4'}>
                        <i className={pendingSync ? 'ri-time-line text-yellow-600 text-5xl' : 'ri-checkbox-circle-fill text-green-500 text-5xl'}></i>
                    </div>
                    {pendingSync ? (
                        <>
                            <h3 className='text-xl font-bold text-yellow-700'>Pagamento registrado</h3>
                            <p className='text-gray-500 text-center'>Sem conexão no momento — vamos confirmar com o servidor assim que a internet voltar. Comissão prevista de R$ {commissionAmount.toFixed(2)}.</p>
                        </>
                    ) : (
                        <>
                            <h3 className='text-xl font-bold text-green-700'>Pagamento Confirmado!</h3>
                            <p className='text-gray-500 text-center'>Comissão de R$ {commissionAmount.toFixed(2)} descontada dos créditos.</p>
                        </>
                    )}
                    <p className='text-gray-400 text-sm'>Redirecionando...</p>
                </div>
            ) : (
                <>
                    <h3 className='text-2xl font-semibold mb-3 text-gray-800'>Confirmar Pagamento</h3>
                    <p className='text-gray-500 mb-5'>Receba o dinheiro do passageiro e confirme abaixo.</p>

                    {/* Payment Summary */}
                    <div className='bg-gray-50 rounded-2xl p-5 border border-gray-200 mb-5'>
                        <div className='flex justify-between items-center mb-3 pb-3 border-b border-gray-200'>
                            <span className='text-gray-600'>Valor da corrida</span>
                            <span className='text-xl font-bold'>R$ {(props.ride?.fare || 0).toFixed(2)}</span>
                        </div>
                        <div className='flex justify-between items-center mb-3 pb-3 border-b border-gray-200'>
                            <span className='text-gray-600'>Comissão ({props.ride?.commissionPercent ?? '—'}%)</span>
                            <span className='text-red-500 font-semibold'>- R$ {commissionAmount.toFixed(2)}</span>
                        </div>
                        <div className='flex justify-between items-center'>
                            <span className='text-gray-800 font-semibold'>Você fica com (dinheiro)</span>
                            <span className='text-green-600 text-xl font-bold'>R$ {driverKeeps.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className='bg-gray-50 border border-gray-200 rounded-xl p-3 mb-5 flex items-start gap-2'>
                        <i className="ri-information-line text-gray-400 mt-0.5"></i>
                        <p className='text-sm text-gray-600'>A comissão de <strong>R$ {commissionAmount.toFixed(2)}</strong> será descontada dos seus créditos na carteira.</p>
                    </div>

                    <button
                        onClick={confirmPayment}
                        disabled={confirmPaymentMutation.isPending}
                        className='w-full flex text-lg justify-center bg-green-500 hover:bg-green-600 text-white font-bold p-4 rounded-xl transition-all active:scale-95 shadow-lg shadow-green-500/20'
                    >
                        {confirmPaymentMutation.isPending ? (
                            <span className='flex items-center gap-2'>
                                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                </svg>
                                Confirmando...
                            </span>
                        ) : (
                            <span className='flex items-center gap-2'>
                                <i className="ri-hand-coin-fill text-xl"></i>
                                Pagamento Recebido
                            </span>
                        )}
                    </button>
                </>
            )}
        </div>
    )
}

export default FinishRide