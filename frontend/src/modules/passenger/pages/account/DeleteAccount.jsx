import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useToast } from '@/contexts/ToastContext';

const DeleteAccount = () => {
    const navigate = useNavigate();
    const { addToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const isButtonEnabled = confirmText === 'EXCLUIR' && password.length >= 1;

    const handleDelete = async () => {
        setLoading(true);
        try {
            await axios.delete(`${import.meta.env.VITE_BASE_URL}/users/profile`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                data: { password } // Enviando senha para confirmação no backend
            });
            addToast('Conta excluída com sucesso.', 'success');
            // Remove token and redirect to start
            localStorage.removeItem('token');
            setTimeout(() => navigate('/'), 2000);
        } catch (error) {
            addToast('Falha ao excluir (API offline)', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10">
                <i onClick={() => navigate('/profile')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"></i>
                <h2 className="text-xl font-semibold flex-1 text-red-600">Excluir Conta</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
                <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex gap-3 mb-6">
                    <i className="ri-error-warning-fill text-2xl text-red-500 mt-0.5"></i>
                    <div>
                        <h3 className="font-bold text-red-700 mb-1">Ação irreversível</h3>
                        <p className="text-sm text-red-600">Ao deletar sua conta, todo o seu histórico de viagens, cupons, saldo na carteira e cartões salvos serão perdidos permanentemente.</p>
                    </div>
                </div>

                <div className="mb-6">
                    <label className="font-semibold text-gray-800 mb-2 block">
                        Para confirmar, digite <span className="font-bold text-red-500 uppercase tracking-widest bg-red-50 px-2 py-0.5 rounded">EXCLUIR</span> abaixo:
                    </label>
                    <input 
                        type="text" 
                        placeholder="EXCLUIR"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        className="w-full bg-white border border-gray-200 px-4 py-3 rounded-xl outline-none focus:border-red-400 font-bold uppercase tracking-widest text-red-600 placeholder-gray-300 text-center"
                    />
                </div>

                {confirmText === 'EXCLUIR' && (
                    <div className="animate-fade-in">
                        <label className="font-semibold text-gray-800 mb-2 block">
                            Digite sua senha para finalizar:
                        </label>
                        <div className="relative">
                            <input 
                                type={showPassword ? "text" : "password"} 
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Sua senha atual"
                                className="w-full bg-white border border-gray-200 pl-4 pr-12 py-3 rounded-xl outline-none focus:border-red-400 font-medium"
                            />
                            <i 
                                onClick={() => setShowPassword(!showPassword)}
                                className={`ri-eye-${showPassword ? 'off-' : ''}line absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg cursor-pointer`}
                            ></i>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-5 bg-white border-t border-gray-100 pb-10">
                <button 
                    onClick={handleDelete}
                    disabled={!isButtonEnabled || loading}
                    className={`w-full py-4 rounded-xl font-semibold text-lg flex justify-center items-center gap-2 shadow-sm transition-all ${
                        isButtonEnabled 
                        ? 'bg-red-600 text-white active:scale-[0.98]' 
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                >
                    {loading ? <i className="ri-loader-4-line animate-spin text-xl"></i> : 'Sim, excluir minha conta'}
                </button>
            </div>
        </div>
    );
};

export default DeleteAccount;
