import React from 'react';
import { useNavigate } from 'react-router-dom';

const Profile = () => {
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10 text-center">
                <i onClick={() => navigate('/account')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform absolute left-5"></i>
                <h2 className="text-xl font-semibold flex-1 text-gray-800">Minha Conta</h2>
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* Perfil */}
                <div className="pt-4 px-4 pb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Perfil</span>
                </div>
                <div className="bg-white border-y border-gray-100 mb-4">
                    <ul className="flex flex-col">
                        <li onClick={() => navigate('/profile/personal-data')} className="flex items-center justify-between p-4 py-4 border-b border-gray-50 cursor-pointer active:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-4">
                                <i className="ri-profile-line text-2xl text-gray-700"></i>
                                <div>
                                    <span className="font-semibold text-gray-800 text-lg block">Dados pessoais</span>
                                    <span className="text-xs text-gray-500">Nome, contato, documento e foto</span>
                                </div>
                            </div>
                            <i className="ri-arrow-right-s-line text-2xl text-gray-400"></i>
                        </li>
                    </ul>
                </div>

                {/* Segurança */}
                <div className="pt-4 px-4 pb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Segurança</span>
                </div>
                <div className="bg-white border-y border-gray-100 mb-4">
                    <ul className="flex flex-col">
                        <li onClick={() => navigate('/profile/change-password')} className="flex items-center justify-between p-4 py-4 border-b border-gray-50 cursor-pointer active:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-4">
                                <i className="ri-lock-password-line text-2xl text-gray-700"></i>
                                <div>
                                    <span className="font-semibold text-gray-800 text-lg block">Alterar senha</span>
                                    <span className="text-xs text-gray-500">Mantenha sua conta segura</span>
                                </div>
                            </div>
                            <i className="ri-arrow-right-s-line text-2xl text-gray-400"></i>
                        </li>
                        <li className="flex items-center justify-between p-4 py-4 border-b border-gray-50 opacity-60">
                            <div className="flex items-center gap-4">
                                <i className="ri-history-line text-2xl text-gray-500"></i>
                                <div>
                                    <span className="font-semibold text-gray-600 text-lg block flex items-center gap-2">
                                        Sessões ativas <span className="bg-gray-200 text-gray-600 text-[10px] px-2 py-0.5 rounded-md font-bold uppercase">Em breve</span>
                                    </span>
                                    <span className="text-xs text-gray-500">Veja onde você está logado</span>
                                </div>
                            </div>
                            <i className="ri-arrow-right-s-line text-2xl text-gray-300"></i>
                        </li>
                        <li className="flex items-center justify-between p-4 py-4 opacity-60">
                            <div className="flex items-center gap-4">
                                <i className="ri-smartphone-line text-2xl text-gray-500"></i>
                                <div>
                                    <span className="font-semibold text-gray-600 text-lg block flex items-center gap-2">
                                        Dispositivos conectados <span className="bg-gray-200 text-gray-600 text-[10px] px-2 py-0.5 rounded-md font-bold uppercase">Em breve</span>
                                    </span>
                                    <span className="text-xs text-gray-500">Gerencie celulares aprovados</span>
                                </div>
                            </div>
                            <i className="ri-arrow-right-s-line text-2xl text-gray-300"></i>
                        </li>
                    </ul>
                </div>

                {/* Sobre */}
                <div className="pt-4 px-4 pb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Sobre</span>
                </div>
                <div className="bg-white border-y border-gray-100 mb-6">
                    <ul className="flex flex-col">
                        <li onClick={() => navigate('/profile/terms')} className="flex items-center justify-between p-4 py-4 border-b border-gray-50 cursor-pointer active:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-4">
                                <i className="ri-file-text-line text-2xl text-gray-700"></i>
                                <span className="font-semibold text-gray-800 text-lg">Termos de uso</span>
                            </div>
                            <i className="ri-arrow-right-s-line text-2xl text-gray-400"></i>
                        </li>
                        <li onClick={() => navigate('/profile/privacy')} className="flex items-center justify-between p-4 py-4 cursor-pointer active:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-4">
                                <i className="ri-shield-check-fill text-2xl text-gray-700"></i>
                                <span className="font-semibold text-gray-800 text-lg">Política de privacidade</span>
                            </div>
                            <i className="ri-arrow-right-s-line text-2xl text-gray-400"></i>
                        </li>
                    </ul>
                </div>

                {/* Zona de Perigo */}
                <div className="px-4 pb-8">
                    <div onClick={() => navigate('/profile/delete-account')} className="bg-white border border-red-100 rounded-xl p-4 py-4 flex items-center justify-between cursor-pointer active:bg-red-50 transition-colors">
                        <div className="flex items-center gap-4">
                            <i className="ri-delete-bin-line text-2xl text-red-500"></i>
                            <span className="font-semibold text-red-600 text-lg">Excluir conta</span>
                        </div>
                        <i className="ri-arrow-right-s-line text-2xl text-red-300"></i>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Profile;
