import React from 'react'
import { vehicleImages } from '../assets/vehicleAssets'

const VehiclePanel = (props) => {
    return (
        <div>
            <h5 className='p-1 text-center w-[93%] absolute top-0' onClick={() => {
                props.setVehiclePanel(false)
            }}><i className="text-3xl text-gray-300 ri-arrow-down-wide-line"></i></h5>
            <h3 className='text-2xl font-semibold mb-5 text-gray-800'>Escolha um Veículo</h3>
            <div onClick={() => {
                props.setConfirmRidePanel(true)
                props.selectVehicle('car')
            }} className='flex border-2 border-gray-200 active:border-green-500 mb-2 rounded-xl w-full p-3 items-center justify-between bg-gray-50 transition-colors cursor-pointer'>
                <img className='h-10 object-contain' src={vehicleImages.car} alt="car" />
                <div className='w-1/2'>
                    <h4 className='font-medium text-base text-gray-800'>MoveGo <span className='text-green-500'><i className="ri-user-3-fill"></i>4</span></h4>
                    <h5 className='font-medium text-sm text-gray-500'>2 mins away </h5>
                    <p className='font-normal text-xs text-gray-400'>Viagens diárias econômicas</p>
                </div>
                <h2 className='text-lg font-semibold text-green-600'>
                    {props.fare?.fare?.car ? `R$${props.fare.fare.car} - ${props.fare.fareMax?.car}` : ''}
                </h2>
            </div>
            <div onClick={() => {
                props.setConfirmRidePanel(true)
                props.selectVehicle('moto')
            }} className='flex border-2 border-gray-200 active:border-green-500 mb-2 rounded-xl w-full p-3 items-center justify-between bg-gray-50 transition-colors cursor-pointer'>
                <img className='h-10 object-contain' src={vehicleImages.moto} alt="moto" />
                <div className='w-1/2'>
                    <h4 className='font-medium text-base text-gray-800'>MoveMoto <span className='text-green-500'><i className="ri-user-3-fill"></i>1</span></h4>
                    <h5 className='font-medium text-sm text-gray-500'>3 mins away </h5>
                    <p className='font-normal text-xs text-gray-400'>Para evitar trânsito</p>
                </div>
                <h2 className='text-lg font-semibold text-green-600'>
                    {props.fare?.fare?.moto ? `R$${props.fare.fare.moto} - ${props.fare.fareMax?.moto}` : ''}
                </h2>
            </div>
            <div onClick={() => {
                props.setConfirmRidePanel(true)
                props.selectVehicle('auto')
            }} className='flex border-2 border-gray-200 active:border-green-500 mb-2 rounded-xl w-full p-3 items-center justify-between bg-gray-50 transition-colors cursor-pointer'>
                <img className='h-10 object-contain' src={vehicleImages.auto} alt="auto" />
                <div className='w-1/2'>
                    <h4 className='font-medium text-base text-gray-800'>MoveAuto <span className='text-green-500'><i className="ri-user-3-fill"></i>3</span></h4>
                    <h5 className='font-medium text-sm text-gray-500'>3 mins away </h5>
                    <p className='font-normal text-xs text-gray-400'>Viagens locais baratas</p>
                </div>
                <h2 className='text-lg font-semibold text-green-600'>
                    {props.fare?.fare?.auto ? `R$${props.fare.fare.auto} - ${props.fare.fareMax?.auto}` : ''}
                </h2>
            </div>
            
            <p className='text-xs text-center text-gray-400 mt-4 px-4'>
                O valor apresentado é uma estimativa. O preço final será calculado conforme a distância realmente percorrida.
            </p>
        </div>
    )
}

export default VehiclePanel