import React, { useContext } from 'react'
import Avatar from '@/shared/components/Avatar'
import Button from '@/shared/components/ui/Button'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { vehicleLabels } from '@/shared/assets/vehicleAssets'

// Fase B da experiência de corrida ativa (2026-08-03): o countdown de 20s saiu. Ele só
// escondia o painel no frontend, sem declinar nada no servidor — a corrida continuava
// 'requested' no banco, mas sumia da tela do motorista para sempre (estado fantasma).
// Agora a oferta só sai da tela quando: o motorista aceita, outro motorista aceita
// ('ride-taken'), o passageiro cancela ('ride-cancelled') ou o motorista toca "Ignorar"
// — e mesmo ignorada ela continua acessível no card "Corrida disponível" da Home.

const haversineKm = (a, b) => {
    if (!a || !b) return null
    const toRad = (v) => (v * Math.PI) / 180
    const R = 6371
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const sinA = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(sinA), Math.sqrt(1 - sinA))
}

const RidePopUp = (props) => {
    const { userLocation } = useContext(LocationContext)

    // §2.10 do relatório: a distância até o passageiro (não a distância DA corrida) é a
    // informação que mais pesa na decisão de aceitar — antes não existia em lugar nenhum.
    const distanceToPickupKm = haversineKm(userLocation, props.ride?.pickupCoordinates)
    const vehicleLabel = vehicleLabels[props.ride?.vehicleType] || props.ride?.vehicleType

    return (
        <div>
            <div className='flex items-center justify-between mb-4'>
                <h3 className='text-2xl font-semibold text-ink-900'>Nova Corrida Disponível!</h3>
            </div>

            <div className='flex items-center justify-between p-3 bg-brand-50 border-2 border-brand-100 rounded-panel'>
                <div className='flex items-center gap-3'>
                    <Avatar firstname={props.ride?.user?.fullname?.firstname} lastname={props.ride?.user?.fullname?.lastname} className='border-2 border-white' />
                    <div>
                        <h2 className='text-lg font-bold capitalize text-ink-900'>
                            {props.ride?.user?.fullname?.firstname} {props.ride?.user?.fullname?.lastname}
                        </h2>
                        <p className='text-xs text-brand-600 font-medium'>{vehicleLabel}</p>
                    </div>
                </div>
                <div className='text-right'>
                    <h5 className='text-xl font-bold text-ink-900'>
                        {distanceToPickupKm != null ? `${distanceToPickupKm.toFixed(1)} km` : '—'}
                    </h5>
                    <p className='text-xs text-ink-600'>até você</p>
                </div>
            </div>
            <div className='flex gap-2 justify-between flex-col items-center'>
                <div className='w-full mt-5'>
                    <div className='flex items-center gap-5 p-3 border-b-2 border-line'>
                        <i className="ri-map-pin-user-fill text-brand-500 text-lg"></i>
                        <div>
                            <h3 className='text-base font-semibold text-ink-900'>{props.ride?.pickup?.split(',')[0]}</h3>
                            <p className='text-sm -mt-1 text-ink-600'>{props.ride?.pickup}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3 border-b-2 border-line'>
                        <i className="text-lg ri-map-pin-2-fill text-danger-500"></i>
                        <div>
                            <h3 className='text-base font-semibold text-ink-900'>{props.ride?.destination?.split(',')[0]}</h3>
                            <p className='text-sm -mt-1 text-ink-600'>{props.ride?.destination}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3 border-b-2 border-line'>
                        <i className="ri-time-line text-amber-500 text-lg"></i>
                        <div>
                            <h3 className='text-base font-semibold text-ink-900'>
                                {props.ride?.estimatedTime ? `${Math.round(props.ride.estimatedTime / 60)} mins` : '—'}
                                {props.ride?.estimatedDistance && (
                                    <span className='text-sm font-normal text-ink-600 ml-2'>
                                        ({(props.ride.estimatedDistance / 1000).toFixed(1)} km da corrida)
                                    </span>
                                )}
                            </h3>
                            <p className='text-sm -mt-1 text-ink-600'>Tempo Estimado</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3'>
                        <i className="ri-currency-line text-brand-500 text-lg"></i>
                        <div className='w-full'>
                            {/* Antes mostrava "estimatedPriceMin - estimatedPriceMax" — os dois
                                campos são sempre o MESMO número (ver ride.service.js), então a
                                tela sempre exibia uma "faixa" de um único valor duplicado. */}
                            <h3 className='text-base font-semibold text-ink-900'>
                                R$ {props.ride?.fare?.toFixed ? props.ride.fare.toFixed(2) : props.ride?.fare}
                            </h3>
                            <div className='flex justify-between items-center text-sm -mt-1 text-ink-600'>
                                <p>Pagamento: {props.ride?.paymentMethod === 'card' ? 'Cartão' : props.ride?.paymentMethod === 'pix' ? 'PIX' : 'Dinheiro'}</p>
                                <p className='text-danger-500 font-medium'>Taxa: R$ {props.ride?.commissionAmount?.toFixed(2) ?? '—'}</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className='mt-3 w-full flex gap-2'>
                    <Button
                        onClick={() => {
                            props.setConfirmRidePopupPanel(true)
                            props.confirmRide()
                        }}
                        fullWidth={false}
                        className="flex-1"
                    >
                        <i className="ri-checkbox-circle-line mr-1"></i>Aceitar
                    </Button>
                    <Button
                        variant="secondary"
                        fullWidth={false}
                        className="flex-1"
                        onClick={() => {
                            props.setRidePopupPanel(false)
                        }}
                    >Ignorar</Button>
                </div>
            </div>
        </div>
    )
}

export default RidePopUp
