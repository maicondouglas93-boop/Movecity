import React, { useEffect, useState } from 'react'
import { vehicleImages } from '@/assets/vehicleAssets'
import { getVehicleCategories } from '@/services/vehicleCategoriesApi'

const VehiclePanel = (props) => {
    const [categories, setCategories] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        getVehicleCategories()
            .then((data) => {
                if (!cancelled) setCategories(data)
            })
            .catch(() => {
                if (!cancelled) setCategories([])
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => { cancelled = true }
    }, [])

    return (
        <div className='pb-6'>
            <h5 className='p-1 text-center w-[93%] absolute top-0' onClick={() => {
                props.setVehiclePanel(false)
            }}><i className="text-3xl text-gray-300 ri-arrow-down-wide-line"></i></h5>
            <h3 className='text-2xl font-semibold mb-5 text-gray-800'>Escolha um Veículo</h3>

            {loading ? (
                <div className='flex justify-center py-8'>
                    <i className="ri-loader-4-line text-2xl animate-spin text-gray-400"></i>
                </div>
            ) : categories.length === 0 ? (
                <p className='text-center text-gray-500 py-8'>Nenhuma categoria de veículo disponível no momento.</p>
            ) : (
                categories.map((category) => (
                    <div
                        key={category._id || category.name}
                        onClick={() => {
                            props.setConfirmRidePanel(true)
                            props.selectVehicle(category.name)
                        }}
                        className='flex border-2 border-gray-200 active:border-green-500 mb-2 rounded-xl w-full p-3 items-center justify-between bg-gray-50 transition-colors cursor-pointer'
                    >
                        <img className='h-10 object-contain' src={vehicleImages[category.iconKey] || vehicleImages.car} alt={category.displayName} />
                        <div className='w-1/2'>
                            <h4 className='font-medium text-base text-gray-800'>
                                {category.displayName} <span className='text-green-500'><i className="ri-user-3-fill"></i>{category.capacity}</span>
                            </h4>
                            {category.description && (
                                <p className='font-normal text-xs text-gray-400'>{category.description}</p>
                            )}
                        </div>
                        <h2 className='text-lg font-semibold text-green-600'>
                            {props.fare?.fare?.[category.name] ? `R$${props.fare.fare[category.name]}` : ''}
                        </h2>
                    </div>
                ))
            )}

            <p className='text-xs text-center text-gray-400 mt-4 px-4'>
                O valor apresentado é uma estimativa. O preço final será calculado conforme a distância realmente percorrida.
            </p>
        </div>
    )
}

export default VehiclePanel
