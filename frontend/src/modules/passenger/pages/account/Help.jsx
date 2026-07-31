import React from 'react';
import { useNavigate } from 'react-router-dom';

const Help = () => {
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10">
                <i onClick={() => navigate('/account')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"></i>
                <h2 className="text-xl font-semibold">Central de Ajuda</h2>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="p-5 bg-black text-white mb-2">
                    <h1 className="text-2xl font-bold mb-2">Como podemos ajudar?</h1>
                    <p className="text-sm text-gray-300">Selecione o assunto abaixo para encontrar a solução mais rápida.</p>
                </div>

                <div className="bg-white mb-2">
                    <ul className="flex flex-col">
                        <li className="flex items-center justify-between p-4 border-b border-gray-100 cursor-pointer active:bg-gray-50">
                            <div className="flex items-center gap-4">
                                <i className="ri-alert-fill text-xl text-orange-500"></i>
                                <div>
                                    <span className="font-semibold text-gray-800 block">Problemas com uma corrida</span>
                                    <span className="text-xs text-gray-500">Valores incorretos, rota ruim, acidentes.</span>
                                </div>
                            </div>
                            <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                        </li>
                        <li className="flex items-center justify-between p-4 border-b border-gray-100 cursor-pointer active:bg-gray-50">
                            <div className="flex items-center gap-4">
                                <i className="ri-search-eye-fill text-xl text-blue-500"></i>
                                <div>
                                    <span className="font-semibold text-gray-800 block">Objeto perdido</span>
                                    <span className="text-xs text-gray-500">Esqueci algo no carro do motorista.</span>
                                </div>
                            </div>
                            <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                        </li>
                        <li className="flex items-center justify-between p-4 border-b border-gray-100 cursor-pointer active:bg-gray-50">
                            <div className="flex items-center gap-4">
                                <i className="ri-bank-card-fill text-xl text-green-500"></i>
                                <div>
                                    <span className="font-semibold text-gray-800 block">Problemas no Pagamento</span>
                                    <span className="text-xs text-gray-500">Cobrança duplicada, cartão recusado.</span>
                                </div>
                            </div>
                            <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                        </li>
                    </ul>
                </div>

                <div className="p-4">
                    <h3 className="font-semibold text-gray-700 mb-3 px-1">Suporte Direto</h3>
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                        <div className="flex items-center justify-between p-4 border-b border-gray-100 cursor-pointer active:bg-gray-50">
                            <div className="flex items-center gap-3">
                                <i className="ri-customer-service-2-fill text-lg text-gray-600"></i>
                                <span className="font-medium text-gray-800">Falar com o suporte (Chat)</span>
                            </div>
                            <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                        </div>
                        <div className="flex items-center justify-between p-4 border-b border-gray-100 cursor-pointer active:bg-gray-50">
                            <div className="flex items-center gap-3">
                                <i className="ri-ticket-fill text-lg text-gray-600"></i>
                                <span className="font-medium text-gray-800">Abrir novo chamado</span>
                            </div>
                            <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                        </div>
                        <div className="flex items-center justify-between p-4 cursor-pointer active:bg-gray-50">
                            <div className="flex items-center gap-3">
                                <i className="ri-history-line text-lg text-gray-600"></i>
                                <span className="font-medium text-gray-800">Histórico de chamados</span>
                            </div>
                            <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Help;
