import React, { useState, useEffect, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { enqueueOfflineAction } from '@/services/offlineQueue'
import { getAccessToken } from '@/services/session'
import * as Sentry from '@sentry/react'
import Avatar from '@/shared/components/Avatar'
import Button from '@/shared/components/ui/Button'
import { useToast } from '@/contexts/ToastContext'
import { RideContext } from '@/contexts/RideContext'

// Fase A da experiência de corrida ativa (2026-08-03): o status dos botões vem da
// corrida real (backend), não mais de um useState fixo em 'accepted' — depois de um
// refresh, os botões voltavam pra "A caminho" mesmo com o motorista já no local.
// 'waiting_passenger' mostra a mesma UI de 'arrived' (campo do PIN).
const deriveStatusFromRide = (status) => {
    if (status === 'waiting_passenger') return 'arrived'
    if ([ 'accepted', 'going_to_pickup', 'arrived' ].includes(status)) return status
    return 'accepted'
}

const ConfirmRidePopUp = (props) => {
    const [otp, setOtp] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [rideStatus, setRideStatus] = useState(deriveStatusFromRide(props.ride?.status))
    const [cancelling, setCancelling] = useState(false)
    const navigate = useNavigate()
    const { addToast } = useToast()
    const { setCaptainRide } = useContext(RideContext)

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
        setCancelling(true)
        try {
            await axios.post(`${import.meta.env.VITE_BASE_URL}/rides/captain-cancel`, {
                rideId: props.ride._id
            }, {
                headers: {
                    Authorization: `Bearer ${getAccessToken('captain')}`
                }
            })
            addToast('Corrida liberada — buscando outro motorista para o passageiro.', 'info')
            // Limpa a corrida no RideContext na hora — sem isso, o efeito de restauração
            // do CaptainHome ainda veria a corrida antiga até a próxima sincronização.
            setCaptainRide(null)
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
                    Authorization: `Bearer ${getAccessToken('captain')}`
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
                    Authorization: `Bearer ${getAccessToken('captain')}`
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
            <h3 className='text-2xl font-semibold mb-5 text-ink-900'>Iniciar a Corrida</h3>
            <div className='flex items-center justify-between p-3 border-2 border-brand-100 bg-brand-50 rounded-panel mt-4'>
                <div className='flex items-center gap-3'>
                    <Avatar firstname={props.ride?.user?.fullname?.firstname} lastname={props.ride?.user?.fullname?.lastname} />
                    <div>
                        <h2 className='text-lg font-bold capitalize text-ink-900'>{props.ride?.user?.fullname?.firstname} {props.ride?.user?.fullname?.lastname}</h2>
                        <p className='text-xs text-ink-600 font-medium'>Passageiro</p>
                    </div>
                </div>
                <h5 className='text-lg font-bold text-ink-900'>{props.ride?.estimatedDistance ? (props.ride.estimatedDistance / 1000).toFixed(1) + ' KM' : '—'}</h5>
            </div>
            <div className='flex gap-2 justify-between flex-col items-center'>
                <div className='w-full mt-5'>
                    <div className='flex items-center gap-5 p-3 border-b-2 border-line'>
                        <i className="ri-map-pin-user-fill text-brand-500"></i>
                        <div>
                            <h3 className='text-base font-medium text-ink-900'>{props.ride?.pickup?.split(',')[0]}</h3>
                            <p className='text-sm -mt-1 text-ink-600'>{props.ride?.pickup}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3 border-b-2 border-line'>
                        <i className="text-lg ri-map-pin-2-fill text-danger-500"></i>
                        <div>
                            <h3 className='text-base font-medium text-ink-900'>{props.ride?.destination?.split(',')[0]}</h3>
                            <p className='text-sm -mt-1 text-ink-600'>{props.ride?.destination}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3'>
                        <i className="ri-currency-line text-brand-500"></i>
                        <div>
                            <h3 className='text-base font-medium text-ink-900'>R${props.ride?.fare}</h3>
                            <p className='text-sm -mt-1 text-ink-600'>{props.ride?.paymentMethod === 'pix' ? 'Pix' : props.ride?.paymentMethod === 'carteira' ? 'Carteira' : props.ride?.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'}</p>
                        </div>
                    </div>
                </div>

                <div className='mt-4 w-full'>
                    {rideStatus === 'accepted' && (
                        <Button
                            onClick={() => updateStatus('going_to_pickup')}
                            loading={loading}
                            className="mt-4"
                        >
                            A caminho
                        </Button>
                    )}

                    {rideStatus === 'going_to_pickup' && (
                        <Button
                            onClick={() => updateStatus('arrived')}
                            loading={loading}
                            className="mt-4"
                        >
                            Cheguei ao local
                        </Button>
                    )}

                    {rideStatus === 'arrived' && (
                        <form onSubmit={submitHandler}>
                            <label htmlFor="captain-otp-input" className='block text-sm font-medium text-ink-600 mb-1'>Digite o PIN do passageiro</label>
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
                                className='bg-surface-alt px-6 py-4 font-mono text-2xl text-center tracking-widest rounded-panel w-full mt-2 border-2 border-transparent focus:border-brand-500 focus:bg-brand-50 focus:outline-none transition-colors'
                                placeholder='• • • • • •'
                                maxLength={6}
                            />

                            {error && (
                                <div className='flex items-center gap-2 bg-danger-50 border border-danger-500/30 rounded-panel p-3 mt-3'>
                                    <i className="ri-error-warning-line text-danger-500"></i>
                                    <p className='text-sm text-danger-600'>{error}</p>
                                </div>
                            )}

                            <Button type="submit" loading={loading} className="mt-4">
                                Iniciar Corrida
                            </Button>
                        </form>
                    )}

                    <Button
                        type="button"
                        variant="secondary"
                        onClick={cancelRide}
                        loading={cancelling}
                        className="mt-2"
                    >Cancelar</Button>
                </div>
            </div>
        </div>
    )
}

export default ConfirmRidePopUp
