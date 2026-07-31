import React, { useContext } from 'react';
import CaptainHeader from '@/modules/driver/components/CaptainHeader';
import { CaptainDataContext } from '@/contexts/CaptainContext';

const CaptainEarnings = () => {
    const { captain } = useContext(CaptainDataContext);

    return (
        <div className="h-screen bg-gray-50 flex flex-col pt-24">
            <div className="bg-white p-6 shadow-sm z-10 border-b border-gray-100">
                <h1 className="text-2xl font-bold text-gray-800">Ganhos</h1>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-6">
                <div className="bg-black text-white rounded-2xl p-6 shadow-lg mb-6 text-center">
                    <p className="text-gray-300 text-sm mb-1">Ganhos Totais</p>
                    <h2 className="text-4xl font-bold mb-2">R$ {captain?.earnings?.toFixed(2) || '0.00'}</h2>
                    <p className="text-gray-400 text-xs">Total acumulado na plataforma</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 text-center">
                        <i className="ri-route-line text-2xl text-blue-500 mb-2 block"></i>
                        <h3 className="text-xl font-bold">{captain?.totalRides || 0}</h3>
                        <p className="text-xs text-gray-500">Corridas Concluídas</p>
                    </div>
                    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 text-center">
                        <i className="ri-star-fill text-2xl text-yellow-500 mb-2 block"></i>
                        <h3 className="text-xl font-bold">{captain?.rating?.toFixed(1) || '5.0'}</h3>
                        <p className="text-xs text-gray-500">Avaliação Média</p>
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                    <h3 className="font-semibold text-gray-800 mb-4">Desempenho</h3>
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-600">Taxa de Aceitação</span>
                                <span className="font-medium text-green-600">{captain?.acceptanceRate || 100}%</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2">
                                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${captain?.acceptanceRate || 100}%` }}></div>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-600">Taxa de Cancelamento</span>
                                <span className="font-medium text-red-500">{captain?.cancellationRate || 0}%</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2">
                                <div className="bg-red-500 h-2 rounded-full" style={{ width: `${captain?.cancellationRate || 0}%` }}></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <CaptainHeader />
        </div>
    );
};

export default CaptainEarnings;
