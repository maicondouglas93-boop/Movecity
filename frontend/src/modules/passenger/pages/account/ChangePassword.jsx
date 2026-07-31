import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import axios from 'axios';
import { useToast } from '@/contexts/ToastContext';

const passwordSchema = z.object({
    currentPassword: z.string().min(1, "Senha atual obrigatória"),
    newPassword: z.string()
        .min(8, "Mínimo de 8 caracteres")
        .regex(/[0-9]/, "Deve conter números")
        .regex(/[^a-zA-Z0-9]/, "Deve conter símbolo especial"),
    confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"]
});

const ChangePassword = () => {
    const navigate = useNavigate();
    const { addToast } = useToast();
    const [loading, setLoading] = useState(false);
    
    // Toggle visibilidade
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const { register, handleSubmit, watch, formState: { errors }, reset } = useForm({
        resolver: zodResolver(passwordSchema)
    });

    const newPasswordVal = watch("newPassword", "");

    // Indicador de força da senha super básico
    const getPasswordStrength = () => {
        if (!newPasswordVal) return 0;
        let score = 0;
        if (newPasswordVal.length > 7) score += 33;
        if (/[0-9]/.test(newPasswordVal)) score += 33;
        if (/[^a-zA-Z0-9]/.test(newPasswordVal)) score += 34;
        return score;
    };

    const strength = getPasswordStrength();
    const strengthColor = strength < 40 ? 'bg-red-500' : strength < 70 ? 'bg-yellow-500' : 'bg-green-500';

    const onSubmit = async (data) => {
        setLoading(true);
        try {
            await axios.put(`${import.meta.env.VITE_BASE_URL}/users/password`, {
                currentPassword: data.currentPassword,
                newPassword: data.newPassword
            }, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
            });
            addToast('Senha alterada com sucesso!', 'success');
            addToast('Logout feito nos outros dispositivos.', 'info');
            reset();
            setTimeout(() => navigate('/profile'), 2000);
        } catch (error) {
            addToast('Erro (API não encontrada)', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10">
                <i onClick={() => navigate('/profile')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"></i>
                <h2 className="text-xl font-semibold flex-1 text-gray-800">Alterar senha</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
                <div className="mb-6">
                    <p className="text-gray-500 text-sm">Sua senha deve ter pelo menos 8 caracteres, contendo números e símbolos especiais para garantir sua segurança.</p>
                </div>

                <form id="password-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
                    
                    <div>
                        <label className="text-xs font-semibold text-gray-500 ml-1 mb-1 block">Senha Atual</label>
                        <div className="relative">
                            <input 
                                type={showCurrent ? "text" : "password"} 
                                {...register('currentPassword')}
                                className={`w-full bg-white border ${errors.currentPassword ? 'border-red-400' : 'border-gray-200'} pl-4 pr-12 py-3 rounded-xl outline-none focus:border-black font-medium`}
                            />
                            <i 
                                onClick={() => setShowCurrent(!showCurrent)}
                                className={`ri-eye-${showCurrent ? 'off-' : ''}line absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg cursor-pointer`}
                            ></i>
                        </div>
                        {errors.currentPassword && <p className="text-xs text-red-500 mt-1 ml-1">{errors.currentPassword.message}</p>}
                    </div>

                    <div className="border-t border-gray-200 pt-5">
                        <label className="text-xs font-semibold text-gray-500 ml-1 mb-1 block">Nova Senha</label>
                        <div className="relative">
                            <input 
                                type={showNew ? "text" : "password"} 
                                {...register('newPassword')}
                                className={`w-full bg-white border ${errors.newPassword ? 'border-red-400' : 'border-gray-200'} pl-4 pr-12 py-3 rounded-xl outline-none focus:border-black font-medium`}
                            />
                            <i 
                                onClick={() => setShowNew(!showNew)}
                                className={`ri-eye-${showNew ? 'off-' : ''}line absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg cursor-pointer`}
                            ></i>
                        </div>
                        {/* Indicador de Força */}
                        <div className="mt-2 flex gap-1 h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                            <div className={`h-full transition-all duration-300 ${strengthColor}`} style={{ width: `${strength}%` }}></div>
                        </div>
                        {errors.newPassword && <p className="text-xs text-red-500 mt-1 ml-1">{errors.newPassword.message}</p>}
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-gray-500 ml-1 mb-1 block">Confirmar Nova Senha</label>
                        <div className="relative">
                            <input 
                                type={showConfirm ? "text" : "password"} 
                                {...register('confirmPassword')}
                                className={`w-full bg-white border ${errors.confirmPassword ? 'border-red-400' : 'border-gray-200'} pl-4 pr-12 py-3 rounded-xl outline-none focus:border-black font-medium`}
                            />
                            <i 
                                onClick={() => setShowConfirm(!showConfirm)}
                                className={`ri-eye-${showConfirm ? 'off-' : ''}line absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg cursor-pointer`}
                            ></i>
                        </div>
                        {errors.confirmPassword && <p className="text-xs text-red-500 mt-1 ml-1">{errors.confirmPassword.message}</p>}
                    </div>
                </form>
            </div>

            <div className="p-5 bg-white border-t border-gray-100 pb-10">
                <button 
                    type="submit"
                    form="password-form"
                    disabled={loading}
                    className="w-full bg-black text-white font-semibold py-4 rounded-xl active:scale-[0.98] transition-transform flex justify-center items-center gap-2"
                >
                    {loading ? <i className="ri-loader-4-line animate-spin text-xl"></i> : 'Atualizar senha'}
                </button>
            </div>
        </div>
    );
};

export default ChangePassword;
