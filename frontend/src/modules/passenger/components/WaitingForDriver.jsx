import React from 'react'
import { vehicleImages, vehicleLabels } from '@/assets/vehicleAssets'

const WaitingForDriver = (props) => {
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
    if (!props.ride) return null

    const captainVehicleType = props.ride?.captain?.vehicle?.vehicleType || props.ride?.vehicleType || 'car'
    const vehicleImg = vehicleImages[captainVehicleType] || vehicleImages.car
    const vehicleLabel = vehicleLabels[captainVehicleType] || 'MoveGo'

    return (
        <div className='pb-6'>
            <h5 className='p-1 text-center w-[93%] absolute top-0' onClick={() => {
                props.setWaitingForDriver(false)
            }}><i className="text-3xl text-gray-300 ri-arrow-down-wide-line"></i></h5>

            <div className='flex items-center justify-between mb-4'>
                <div>
                    <img className='h-14 object-contain' src={vehicleImg} alt={captainVehicleType} />
                    <p className='text-xs text-center text-gray-500 mt-1 font-medium'>{vehicleLabel}</p>
                </div>
                <div className='text-right'>
                    <h2 className='text-base font-medium capitalize text-gray-800'>{props.ride?.captain?.fullname?.firstname} {props.ride?.captain?.fullname?.lastname}</h2>
                    <h4 className='text-lg font-semibold -mt-1 -mb-1 text-green-600'>{props.ride?.captain?.vehicle?.plate}</h4>
                    <p className='text-sm text-gray-500 capitalize'>{props.ride?.captain?.vehicle?.color} {captainVehicleType}</p>
                </div>
            </div>

            <div className='flex justify-between items-center p-3 bg-green-50 border-2 border-green-200 rounded-xl'>
                <div>
                    <p className='text-sm text-gray-500 mb-1'>Compartilhe o PIN com o motorista</p>
                    <h1 className='text-3xl font-bold tracking-widest text-green-600'>{props.ride?.otp}</h1>
                </div>
                <i className="ri-lock-2-line text-3xl text-green-500"></i>
            </div>

            <div className='flex gap-2 justify-between flex-col items-center'>
                <div className='w-full mt-4'>
                    <div className='flex items-center gap-5 p-3 border-b border-gray-100'>
                        <i className="ri-map-pin-user-fill text-green-500 flex-shrink-0"></i>
                        <div className='min-w-0'>
                            <h3 className='text-base font-medium text-gray-800 truncate'>{extractTitle(props.ride?.pickup)}</h3>
                            <p className='text-sm -mt-1 text-gray-500 truncate'>{extractAddress(props.ride?.pickup)}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3 border-b border-gray-100'>
                        <i className="text-lg ri-map-pin-2-fill text-red-500 flex-shrink-0"></i>
                        <div className='min-w-0'>
                            <h3 className='text-base font-medium text-gray-800 truncate'>{extractTitle(props.ride?.destination)}</h3>
                            <p className='text-sm -mt-1 text-gray-500 truncate'>{extractAddress(props.ride?.destination)}</p>
                        </div>
                    </div>
                    <div className='flex items-center gap-5 p-3'>
                        <i className="ri-currency-line text-green-500 flex-shrink-0"></i>
                        <div>
                            <h3 className='text-base font-medium text-gray-800'>{props.ride?.fare ? `R$${props.ride.fare}` : ''}</h3>
                            <p className='text-sm -mt-1 text-gray-500'>Dinheiro</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default WaitingForDriver