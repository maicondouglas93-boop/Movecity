import React from 'react'
import { vehicleImages, vehicleLabels } from '../assets/vehicleAssets'

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
        <div>
            <h5 className='p-1 text-center w-[93%] absolute top-0' onClick={() => {
                props.setConfirmRidePanel(false)
            }}><i className="text-3xl text-gray-300 ri-arrow-down-wide-line"></i></h5>
            <h3 className='text-2xl font-semibold mb-5 text-gray-800'>Confirme sua Corrida</h3>

            <div className='flex gap-2 justify-between flex-col items-center'>
                <img className='h-24 object-contain' src={vehicleImages[props.vehicleType] || vehicleImages.car} alt="" />
                <p className='text-sm font-medium text-gray-500 mb-2'>{vehicleLabels[props.vehicleType]}</p>
                <div className='w-full mt-3'>
                    <div className='flex items-center gap-5 p-3 border-b border-gray-100'>
                        <i className="ri-map-pin-user-fill text-green-500"></i>
                        <div>
                            <h3 className='text-lg font-medium text-gray-800'>{extractTitle(props.pickup)}</h3>
                            <p className='text-sm -mt-1 text-gray-500'>{extractAddress(props.pickup)}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3 border-b border-gray-100'>
                        <i className="text-lg ri-map-pin-2-fill text-red-500"></i>
                        <div>
                            <h3 className='text-lg font-medium text-gray-800'>{extractTitle(props.destination)}</h3>
                            <p className='text-sm -mt-1 text-gray-500'>{extractAddress(props.destination)}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3'>
                        <i className="ri-currency-line text-green-500"></i>
                        <div>
                            <h3 className='text-lg font-medium text-gray-800'>
                                {props.fare?.fare?.[props.vehicleType] ? `R$${props.fare.fare[props.vehicleType]} - ${props.fare.fareMax?.[props.vehicleType]}` : ''}
                            </h3>
                            <p className='text-sm -mt-1 text-gray-500'>Dinheiro (Estimativa)</p>
                        </div>
                    </div>
                </div>
                <button onClick={() => {
                    props.setVehicleFound(true)
                    props.setConfirmRidePanel(false)
                    props.createRide()
                }} className='w-full mt-5 bg-green-500 hover:bg-green-600 text-white font-bold p-3 rounded-xl text-lg transition-colors shadow-lg shadow-green-500/20'>Confirmar Corrida</button>
            </div>
        </div>
    )
}

export default ConfirmRide