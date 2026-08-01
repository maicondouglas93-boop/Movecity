import React from 'react'
import { vehicleImages, vehicleLabels } from '@/assets/vehicleAssets'

const ConfirmRide = (props) => {
    const extractTitle = (addressStr) => {
        if (!addressStr) return '';
        if (typeof addressStr === 'object') return addressStr.address?.split(',')[0] || '';
        return addressStr.split(',')[0] || '';
    };

    const extractAddress = (addressStr) => {
        if (!addressStr) return '';
        if (typeof addressStr === 'object') return addressStr.address;
        return addressStr.replace(/\s*\(-?\d+\.\d+,\s*-?\d+\.\d+\)$/, '');
    };
    return (
        <div className='pb-6'>
            <h5 className='p-1 text-center w-[93%] absolute top-0' onClick={() => {
                props.setConfirmRidePanel(false)
            }}><i className="text-3xl text-gray-300 ri-arrow-down-wide-line"></i></h5>
            <h3 className='text-2xl font-semibold mb-5 text-gray-800'>Confirme sua Corrida</h3>

            <div className='flex gap-2 justify-between flex-col items-center'>
                <div className='w-full flex items-center justify-between'>
                    <div className='flex flex-col items-center'>
                        <img className='h-20 object-contain' src={vehicleImages[props.vehicleType] || vehicleImages.car} alt="" />
                        <p className='text-sm font-medium text-gray-500 mb-1'>{vehicleLabels[props.vehicleType]}</p>
                    </div>
                    <button 
                        onClick={() => props.setOptionalsPanel(true)}
                        className='px-4 py-2 border border-gray-300 rounded-full text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2'>
                        <i className="ri-box-3-fill text-green-500"></i> Opcionais
                    </button>
                </div>
                <div className='w-full mt-2'>
                    <div className='flex items-center gap-5 p-3 border-b border-gray-100'>
                        <i className="ri-map-pin-user-fill text-green-500 flex-shrink-0"></i>
                        <div className='min-w-0'>
                            <h3 className='text-base font-medium text-gray-800 truncate'>{extractTitle(props.pickup)}</h3>
                            <p className='text-sm -mt-1 text-gray-500 truncate'>{extractAddress(props.pickup)}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3 border-b border-gray-100'>
                        <i className="text-lg ri-map-pin-2-fill text-red-500 flex-shrink-0"></i>
                        <div className='min-w-0'>
                            <h3 className='text-base font-medium text-gray-800 truncate'>{extractTitle(props.destination)}</h3>
                            <p className='text-sm -mt-1 text-gray-500 truncate'>{extractAddress(props.destination)}</p>
                        </div>
                    </div>
                    <div 
                        onClick={() => props.setPaymentPanel(true)}
                        className='flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 rounded-xl transition-colors'>
                        <div className='flex items-center gap-5'>
                            {props.paymentMethod === 'pix' ? (
                                <i className="ri-instance-line text-teal-500 text-xl flex-shrink-0"></i>
                            ) : props.paymentMethod === 'card' ? (
                                <i className="ri-bank-card-fill text-blue-500 text-xl flex-shrink-0"></i>
                            ) : (
                                <i className="ri-money-dollar-box-fill text-green-500 text-xl flex-shrink-0"></i>
                            )}
                            <div>
                                <h3 className='text-base font-medium text-gray-800'>
                                    {props.paymentMethod === 'pix' ? 'Pix' : props.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'}
                                </h3>
                                <p className='text-sm -mt-1 text-gray-500'>Forma de pagamento</p>
                            </div>
                        </div>
                        <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                    </div>

                    <div className='flex items-center gap-5 p-3 border-t border-gray-100 mt-2'>
                        <i className="ri-currency-line text-green-500 flex-shrink-0"></i>
                        <div>
                            <h3 className='text-base font-medium text-gray-800'>
                                {props.fare?.fare?.[props.vehicleType] ? `R$${props.fare.fare[props.vehicleType]} - ${props.fare.fareMax?.[props.vehicleType]}` : ''}
                            </h3>
                            <p className='text-sm -mt-1 text-gray-500'>Valor estimado</p>
                        </div>
                    </div>
                </div>
                <button onClick={() => {
                    props.setVehicleFound(true)
                    props.setConfirmRidePanel(false)
                    props.createRide()
                }} className='w-full mt-4 bg-green-500 hover:bg-green-600 text-white font-bold p-3 rounded-xl text-lg transition-colors shadow-lg shadow-green-500/20'>Confirmar Corrida</button>
            </div>
        </div>
    )
}

export default ConfirmRide