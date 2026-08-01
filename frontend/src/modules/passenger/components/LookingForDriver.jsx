import React from 'react'
import { vehicleImages } from '@/assets/vehicleAssets'

const LookingForDriver = (props) => {
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
                props.setVehicleFound(false)
            }}><i className="text-3xl text-gray-300 ri-arrow-down-wide-line"></i></h5>
            <h3 className='text-2xl font-semibold mb-5 text-gray-800'>Buscando um Motorista</h3>

            {/* Animated search indicator */}
            <div className='flex flex-col items-center mb-4'>
                <div className='relative h-16 w-16 flex items-center justify-center'>
                    <div className='absolute inset-0 rounded-full border-4 border-green-300 animate-ping opacity-55'></div>
                    <div className='absolute inset-2 rounded-full border-4 border-green-400 animate-ping opacity-75 animation-delay-150'></div>
                    <img className='h-12 w-12 absolute rounded-full object-contain bg-white p-1 shadow-md border border-green-200' src={vehicleImages[props.vehicleType] || vehicleImages.car} alt="" />
                </div>
                <p className='text-sm text-green-600 mt-2 animate-pulse'>Buscando motoristas próximos...</p>
            </div>

            <div className='flex gap-2 justify-between flex-col items-center'>
                <div className='w-full'>
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
                    <div className='flex items-center gap-5 p-3'>
                        <i className="ri-currency-line text-green-500 flex-shrink-0"></i>
                        <div>
                            <h3 className='text-base font-medium text-gray-800'>
                                {props.fare?.fare?.[props.vehicleType] ? `R$${props.fare.fare[props.vehicleType]} - ${props.fare.fareMax?.[props.vehicleType]}` : ''}
                            </h3>
                            <p className='text-sm -mt-1 text-gray-500'>{props.paymentMethod === 'pix' ? 'Pix' : props.paymentMethod === 'carteira' ? 'Carteira' : props.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'} (Estimativa)</p>
                        </div>
                    </div>
                </div>
                
                <button 
                    onClick={props.cancelRide} 
                    className='w-full mt-4 bg-red-100 text-red-600 font-semibold p-3 rounded-lg active:bg-red-200 transition-colors border border-red-200'
                >
                    Cancelar Corrida
                </button>
            </div>
        </div>
    )
}

export default LookingForDriver