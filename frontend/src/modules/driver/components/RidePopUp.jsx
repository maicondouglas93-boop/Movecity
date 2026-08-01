import React from 'react'
import Avatar from '@/shared/components/Avatar'

const RidePopUp = (props) => {
    return (
        <div>
            <h5 className='p-1 text-center w-[93%] absolute top-0' onClick={() => {
                props.setRidePopupPanel(false)
            }}><i className="text-3xl text-gray-200 ri-arrow-down-wide-line"></i></h5>
            <h3 className='text-2xl font-semibold mb-5 text-gray-800'>Nova Corrida Disponível!</h3>
            <div className='flex items-center justify-between p-3 bg-green-50 border-2 border-green-200 rounded-xl mt-4'>
                <div className='flex items-center gap-3'>
                    <Avatar firstname={props.ride?.user?.fullname?.firstname} lastname={props.ride?.user?.fullname?.lastname} className='border-2 border-white' />
                    <div>
                        <h2 className='text-lg font-bold capitalize text-gray-800'>
                            {props.ride?.user?.fullname?.firstname} {props.ride?.user?.fullname?.lastname}
                        </h2>
                        <p className='text-xs text-green-600 font-medium'>Passageiro</p>
                    </div>
                </div>
                <div className='text-right'>
                    <h5 className='text-xl font-bold text-gray-800'>{props.ride?.estimatedDistance ? (props.ride.estimatedDistance / 1000).toFixed(1) + ' KM' : '—'}</h5>
                    <p className='text-xs text-gray-500'>Distância</p>
                </div>
            </div>
            <div className='flex gap-2 justify-between flex-col items-center'>
                <div className='w-full mt-5'>
                    <div className='flex items-center gap-5 p-3 border-b-2'>
                        <i className="ri-map-pin-user-fill text-green-500 text-lg"></i>
                        <div>
                            <h3 className='text-base font-semibold text-gray-800'>{props.ride?.pickup?.split(',')[0]}</h3>
                            <p className='text-sm -mt-1 text-gray-500'>{props.ride?.pickup}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3 border-b-2'>
                        <i className="text-lg ri-map-pin-2-fill text-red-500"></i>
                        <div>
                            <h3 className='text-base font-semibold text-gray-800'>{props.ride?.destination?.split(',')[0]}</h3>
                            <p className='text-sm -mt-1 text-gray-500'>{props.ride?.destination}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3 border-b-2'>
                        <i className="ri-time-line text-yellow-500 text-lg"></i>
                        <div>
                            <h3 className='text-base font-semibold text-gray-800'>
                                {props.ride?.estimatedTime ? `${Math.round(props.ride.estimatedTime / 60)} mins` : '—'}
                                {props.ride?.estimatedDistance && (
                                    <span className='text-sm font-normal text-gray-500 ml-2'>
                                        ({(props.ride.estimatedDistance / 1000).toFixed(1)} km)
                                    </span>
                                )}
                            </h3>
                            <p className='text-sm -mt-1 text-gray-500'>Tempo Estimado</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3'>
                        <i className="ri-currency-line text-green-500 text-lg"></i>
                        <div className='w-full'>
                            <h3 className='text-base font-semibold text-gray-800'>
                                R$ {props.ride?.estimatedPriceMin} - {props.ride?.estimatedPriceMax}
                            </h3>
                            <div className='flex justify-between items-center text-sm -mt-1 text-gray-500'>
                                <p>Pagamento: {props.ride?.paymentMethod === 'card' ? 'Cartão' : props.ride?.paymentMethod === 'pix' ? 'PIX' : 'Dinheiro'}</p>
                                <p className='text-red-500 font-medium'>Taxa: R$ {props.ride?.commissionAmount?.toFixed(2) ?? '—'}</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div className='mt-3 w-full flex gap-2'>
                    <button onClick={() => {
                        props.setConfirmRidePopupPanel(true)
                        props.confirmRide()
                    }} className='bg-green-500 hover:bg-green-600 flex-1 text-white font-bold p-3 rounded-xl text-base transition-colors shadow-lg shadow-green-500/20'>
                        <i className="ri-checkbox-circle-line mr-1"></i>Aceitar</button>
                    <button onClick={() => {
                        props.setRidePopupPanel(false)
                    }} className='bg-white border-2 border-gray-200 hover:bg-gray-50 flex-1 text-gray-700 font-bold p-3 rounded-xl text-base transition-colors'>Ignorar</button>
                </div>
            </div>
        </div>
    )
}

export default RidePopUp