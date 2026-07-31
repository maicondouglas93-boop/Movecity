import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaptainDataContext } from '@/contexts/CaptainContext';
import CaptainHeader from '@/modules/driver/components/CaptainHeader';

const CaptainProfile = () => {
    const { captain } = useContext(CaptainDataContext);
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-gray-50 flex flex-col pt-24">
            <div className="bg-white p-6 shadow-sm z-10 border-b border-gray-100 flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-800">Perfil</h1>
                <button onClick={() => navigate('/captain/logout')} className="text-red-500 font-semibold p-2 bg-red-50 rounded-lg">
                    Sair
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-6">
                <div className="bg-white rounded-2xl p-6 shadow-sm mb-6 flex flex-col items-center border border-gray-100">
                    <img 
                        src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRdlMd7stpWUCmjpfRjUsQ72xSWikidbgaI1w&s" 
                        alt="Profile" 
                        className="w-24 h-24 rounded-full border-4 border-yellow-400 mb-4 object-cover"
                    />
                    <h2 className="text-xl font-bold capitalize text-gray-800">
                        {captain?.fullname?.firstname} {captain?.fullname?.lastname}
                    </h2>
                    <p className="text-gray-500">{captain?.email}</p>
                    <div className="mt-4 px-4 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
                        Motorista Parceiro
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
                    <h3 className="font-semibold text-gray-800 mb-4">Informações do Veículo</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between border-b border-gray-50 pb-2">
                            <span className="text-gray-500">Tipo</span>
                            <span className="font-medium capitalize">{captain?.vehicle?.vehicleType}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-50 pb-2">
                            <span className="text-gray-500">Cor</span>
                            <span className="font-medium capitalize">{captain?.vehicle?.color}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-50 pb-2">
                            <span className="text-gray-500">Placa</span>
                            <span className="font-medium uppercase">{captain?.vehicle?.plate}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Capacidade</span>
                            <span className="font-medium">{captain?.vehicle?.capacity} pessoas</span>
                        </div>
                    </div>
                </div>
                
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                    <h3 className="font-semibold text-gray-800 mb-4">Status da Conta</h3>
                    <div className="flex justify-between items-center">
                        <span className="text-gray-500">Aprovação</span>
                        {captain?.approvalStatus === 'approved' ? (
                            <span className="flex items-center gap-1 text-green-600 bg-green-50 px-2 py-1 rounded-md text-sm font-medium">
                                <i className="ri-checkbox-circle-fill"></i> Aprovado
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-orange-600 bg-orange-50 px-2 py-1 rounded-md text-sm font-medium">
                                <i className="ri-time-fill"></i> Pendente
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <CaptainHeader />
        </div>
    );
};

export default CaptainProfile;
