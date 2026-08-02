import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { enqueueOfflineAction } from '@/services/offlineQueue'
import * as Sentry from '@sentry/react'
import Avatar from '@/shared/components/Avatar'
import { useToast } from '@/contexts/ToastContext'

const ConfirmRidePopUp = (props) => {
    const [otp, setOtp] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [rideStatus, setRideStatus] = useState('accepted')
    const [cancelling, setCancelling] = useState(false)
    const navigate = useNavigate()
    const { addToast } = useToast()

    // Auditoria de UX do motorista (2026-08-02, §2.4): antes este botão só fechava os
    // painéis — a corrida continuava atribuída a este motorista no banco, travando-o
    // (pelo índice único de corrida ativa) sem que ele soubesse o motivo. Agora chama o
    // endpoint atômico que devolve a corrida ao despacho pra outro motorista aceitar.
    const cancelRide = async () => {
        setCancelling(true)
        try {
            await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/captain-cancel`, {
                rideId: props.ride._id
            }, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('captain-token')}`
                }
            })
            addToast('Corrida liberada — buscando outro motorista para o passageiro.', 'info')
            props.setConfirmRidePopupPanel(false)
            props.setRidePopupPanel(false)
        } catch (err) {
            console.error('Captain cancel error:', err)
            addToast(err.response?.data?.message || 'Não foi possível cancelar. Tente novamente.', 'error')
        } finally {
            setCancelling(false)
        }
    }

    const updateStatus = async (status) => {
        setLoading(true)
        try {
            await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/update-status`, {
                rideId: props.ride._id,
                status: status
            }, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('captain-token')}`
                }
            })
            setRideStatus(status)
        } catch (err) {
            console.error('Update status error:', err)
            if (!navigator.onLine || err.message === 'Network Error') {
                enqueueOfflineAction({
                    type: 'update-ride-status',
                    rideId: props.ride._id,
                    payload: { rideId: props.ride._id, status }
                }).catch(e => console.error(e));
                setRideStatus(status); // optimistic
            } else {
                setError('Failed to update status')
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
            }
        } finally {
            setLoading(false)
        }
    }

    const submitHandler = async (e) => {
        e.preventDefault()
        if (!otp || otp.length !== 6) {
            return setError('Please enter the 6-digit OTP from the passenger')
        }
        setError('')
        setLoading(true)
        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/start-ride`, {
                params: {
                    rideId: props.ride._id,
                    otp: otp
                },
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('captain-token')}`
                }
            })

            if (response.status === 200) {
                props.setConfirmRidePopupPanel(false)
                props.setRidePopupPanel(false)
                navigate('/captain-riding', { state: { ride: response.data } })
            }
        } catch (err) {
            if (!navigator.onLine || err.message === 'Network Error') {
                enqueueOfflineAction({
                    type: 'start-ride',
                    rideId: props.ride._id,
                    payload: { rideId: props.ride._id, otp: otp }
                }).catch(e => console.error(e));
                props.setConfirmRidePopupPanel(false)
                props.setRidePopupPanel(false)
                navigate('/captain-riding', { state: { ride: props.ride } }) // Optimistic
            } else {
                setError(err.response?.data?.message || 'Invalid OTP. Please try again.')
                Sentry.captureException(err, { tags: { issue: 'api_error' } });
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div>
            <h5 className='p-1 text-center w-[93%] absolute top-0' onClick={() => {
                props.setConfirmRidePopupPanel(false)
            }}><i className="text-3xl text-gray-200 ri-arrow-down-wide-line"></i></h5>
            <h3 className='text-2xl font-semibold mb-5 text-gray-800'>Iniciar a Corrida</h3>
            <div className='flex items-center justify-between p-3 border-2 border-green-200 bg-green-50 rounded-xl mt-4'>
                <div className='flex items-center gap-3'>
                    <Avatar firstname={props.ride?.user?.fullname?.firstname} lastname={props.ride?.user?.fullname?.lastname} />
                    <div>
                        <h2 className='text-lg font-bold capitalize text-gray-800'>{props.ride?.user?.fullname?.firstname} {props.ride?.user?.fullname?.lastname}</h2>
                        <p className='text-xs text-gray-500 font-medium'>Passageiro</p>
                    </div>
                </div>
                <h5 className='text-lg font-bold text-gray-800'>{props.ride?.estimatedDistance ? (props.ride.estimatedDistance / 1000).toFixed(1) + ' KM' : '—'}</h5>
            </div>
            <div className='flex gap-2 justify-between flex-col items-center'>
                <div className='w-full mt-5'>
                    <div className='flex items-center gap-5 p-3 border-b-2'>
                        <i className="ri-map-pin-user-fill text-green-500"></i>
                        <div>
                            <h3 className='text-base font-medium text-gray-800'>{props.ride?.pickup?.split(',')[0]}</h3>
                            <p className='text-sm -mt-1 text-gray-500'>{props.ride?.pickup}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3 border-b-2'>
                        <i className="text-lg ri-map-pin-2-fill text-red-500"></i>
                        <div>
                            <h3 className='text-base font-medium text-gray-800'>{props.ride?.destination?.split(',')[0]}</h3>
                            <p className='text-sm -mt-1 text-gray-500'>{props.ride?.destination}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3'>
                        <i className="ri-currency-line text-green-500"></i>
                        <div>
                            <h3 className='text-base font-medium text-gray-800'>R${props.ride?.fare}</h3>
                            <p className='text-sm -mt-1 text-gray-500'>{props.ride?.paymentMethod === 'pix' ? 'Pix' : props.ride?.paymentMethod === 'carteira' ? 'Carteira' : props.ride?.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'}</p>
                        </div>
                    </div>
                </div>

                <div className='mt-4 w-full'>
                    {rideStatus === 'accepted' && (
                        <button
                            onClick={() => updateStatus('going_to_pickup')}
                            disabled={loading}
                            className='w-full mt-4 text-lg flex justify-center bg-green-500 hover:bg-green-600 disabled:bg-green-400 text-white font-bold p-3 rounded-xl transition-all shadow-lg shadow-green-500/20'
                        >
                            {loading ? 'Atualizando...' : 'A caminho'}
                        </button>
                    )}

                    {rideStatus === 'going_to_pickup' && (
                        <button
                            onClick={() => updateStatus('arrived')}
                            disabled={loading}
                            className='w-full mt-4 text-lg flex justify-center bg-green-500 hover:bg-green-600 disabled:bg-green-400 text-white font-bold p-3 rounded-xl transition-all shadow-lg shadow-green-500/20'
                        >
                            {loading ? 'Atualizando...' : 'Cheguei ao local'}
                        </button>
                    )}

                    {rideStatus === 'arrived' && (
                        <form onSubmit={submitHandler}>
                            <label className='block text-sm font-medium text-gray-600 mb-1'>Digite o PIN do passageiro</label>
                            <input
                                value={otp}
                                onChange={(e) => {
                                    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                                    setOtp(val)
                                    setError('')
                                }}
                                type="text"
                                inputMode="numeric"
                                className='bg-gray-100 px-6 py-4 font-mono text-2xl text-center tracking-widest rounded-xl w-full mt-2 border-2 border-transparent focus:border-green-500 focus:bg-green-50 focus:outline-none transition-colors'
                                placeholder='• • • • • •'
                                maxLength={6}
                            />

                            {error && (
                                <div className='flex items-center gap-2 bg-red-50 border border-red-300 rounded-lg p-3 mt-3'>
                                    <i className="ri-error-warning-line text-red-500"></i>
                                    <p className='text-sm text-red-600'>{error}</p>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className='w-full mt-4 text-lg flex justify-center bg-green-500 hover:bg-green-600 disabled:bg-green-400 text-white font-bold p-3 rounded-xl transition-all shadow-lg shadow-green-500/20'
                            >
                                {loading ? (
                                    <span className='flex items-center gap-2'>
                                        <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                        </svg>
                                        Verificando PIN...
                                    </span>
                                ) : 'Iniciar Corrida'}
                            </button>
                        </form>
                    )}

                    <button
                        type="button"
                        onClick={cancelRide}
                        disabled={cancelling}
                        className='w-full mt-2 bg-white border-2 border-gray-200 hover:bg-gray-50 disabled:opacity-60 text-lg text-gray-700 font-bold p-3 rounded-xl transition-colors'
                    >{cancelling ? 'Cancelando...' : 'Cancelar'}</button>
                </div>
            </div>
        </div>
    )
}

export default ConfirmRidePopUp