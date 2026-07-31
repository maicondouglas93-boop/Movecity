import React from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import CaptainHeader from '@/modules/driver/components/CaptainHeader';

const CaptainRidesHistory = () => {
    const { data: rides = [], isLoading: loading } = useQuery({
        queryKey: ['captainHistory'],
        queryFn: async () => {
            const token = localStorage.getItem('captain-token');
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/captain-history`, {
                headers: { Authorization: `Bearer ${token}` }
            }).catch(() => null);
            return response?.data?.rides || [];
        }
    });

    if (loading) return <div className="h-screen flex items-center justify-center">Carregando...</div>;

    return (
        <div className="h-screen bg-gray-50 flex flex-col pt-24">
            <div className="bg-white p-6 shadow-sm z-10 border-b border-gray-100">
                <h1 className="text-2xl font-bold text-gray-800">Histórico de Corridas</h1>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-6">
                {rides.length === 0 ? (
                    <div className="text-center text-gray-500 mt-20">
                        <i className="ri-car-slash-line text-6xl mb-4 block text-gray-300"></i>
                        <p>Você ainda não realizou nenhuma corrida.</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {rides.map(ride => (
                            <div key={ride._id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-1 rounded-md">
                                        {new Date(ride.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                                    </span>
                                    <span className={`text-sm font-semibold ${ride.status === 'completed' || ride.status === 'finished' ? 'text-green-600' : 'text-orange-500'}`}>
                                        R$ {ride.fare}
                                    </span>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="flex flex-col items-center gap-1 mt-1">
                                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                        <div className="w-0.5 h-6 bg-gray-200"></div>
                                        <div className="w-2 h-2 rounded-full bg-red-500"></div>
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-gray-800 truncate mb-2">{ride.pickup.split(',')[0]}</p>
                                        <p className="text-sm font-medium text-gray-800 truncate">{ride.destination.split(',')[0]}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            
            <CaptainHeader />
        </div>
    );
}

export default CaptainRidesHistory;
