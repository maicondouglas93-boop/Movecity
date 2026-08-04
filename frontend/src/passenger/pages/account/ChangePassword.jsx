import React, { useState } from 'react';
import { getAccessToken } from '@/shared/services/session';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import axios from 'axios';
import { useToast } from '@/shared/contexts/ToastContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import Button from '@/shared/components/ui/Button';

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
    const strengthColor = strength < 40 ? 'bg-danger-500' : strength < 70 ? 'bg-amber-500' : 'bg-brand-500';

    const onSubmit = async (data) => {
        setLoading(true);
        try {
            await axios.put(`${import.meta.env.VITE_BASE_URL}/users/password`, {
                currentPassword: data.currentPassword,
                newPassword: data.newPassword
            }, {
                headers: { Authorization: `Bearer ${getAccessToken('user')}` }
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
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Alterar senha" onBack={() => navigate('/profile')} />

            <div className="flex-1 overflow-y-auto p-5">
                <div className="mb-6">
                    <p className="text-ink-400 text-sm">Sua senha deve ter pelo menos 8 caracteres, contendo números e símbolos especiais para garantir sua segurança.</p>
                </div>

                <form id="password-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">

                    <div>
                        <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">Senha Atual</label>
                        <div className="relative">
                            <input
                                type={showCurrent ? "text" : "password"}
                                {...register('currentPassword')}
                                className={`w-full bg-surface border ${errors.currentPassword ? 'border-danger-500' : 'border-line'} pl-4 pr-12 py-3 rounded-panel outline-none focus:border-brand-500 font-medium text-ink-900`}
                            />
                            <button
                                type="button"
                                onClick={() => setShowCurrent(!showCurrent)}
                                aria-label={showCurrent ? 'Ocultar senha' : 'Mostrar senha'}
                                className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400"
                            >
                                <i className={`ri-eye-${showCurrent ? 'off-' : ''}line text-lg`} aria-hidden="true"></i>
                            </button>
                        </div>
                        {errors.currentPassword && <p className="text-xs text-danger-500 mt-1 ml-1">{errors.currentPassword.message}</p>}
                    </div>

                    <div className="border-t border-line pt-5">
                        <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">Nova Senha</label>
                        <div className="relative">
                            <input
                                type={showNew ? "text" : "password"}
                                {...register('newPassword')}
                                className={`w-full bg-surface border ${errors.newPassword ? 'border-danger-500' : 'border-line'} pl-4 pr-12 py-3 rounded-panel outline-none focus:border-brand-500 font-medium text-ink-900`}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNew(!showNew)}
                                aria-label={showNew ? 'Ocultar senha' : 'Mostrar senha'}
                                className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400"
                            >
                                <i className={`ri-eye-${showNew ? 'off-' : ''}line text-lg`} aria-hidden="true"></i>
                            </button>
                        </div>
                        {/* Indicador de Força */}
                        <div className="mt-2 flex gap-1 h-1.5 w-full bg-line rounded-full overflow-hidden">
                            <div className={`h-full transition-all duration-300 ${strengthColor}`} style={{ width: `${strength}%` }}></div>
                        </div>
                        {errors.newPassword && <p className="text-xs text-danger-500 mt-1 ml-1">{errors.newPassword.message}</p>}
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">Confirmar Nova Senha</label>
                        <div className="relative">
                            <input
                                type={showConfirm ? "text" : "password"}
                                {...register('confirmPassword')}
                                className={`w-full bg-surface border ${errors.confirmPassword ? 'border-danger-500' : 'border-line'} pl-4 pr-12 py-3 rounded-panel outline-none focus:border-brand-500 font-medium text-ink-900`}
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirm(!showConfirm)}
                                aria-label={showConfirm ? 'Ocultar senha' : 'Mostrar senha'}
                                className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400"
                            >
                                <i className={`ri-eye-${showConfirm ? 'off-' : ''}line text-lg`} aria-hidden="true"></i>
                            </button>
                        </div>
                        {errors.confirmPassword && <p className="text-xs text-danger-500 mt-1 ml-1">{errors.confirmPassword.message}</p>}
                    </div>
                </form>
            </div>

            <div className="p-5 bg-surface border-t border-line pb-10">
                <Button type="submit" form="password-form" loading={loading}>
                    Atualizar senha
                </Button>
            </div>
        </div>
    );
};

export default ChangePassword;
