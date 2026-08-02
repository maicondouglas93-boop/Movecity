import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useToast } from '@/contexts/ToastContext';
import Button from '@/shared/components/ui/Button';
import { clearSession } from '@/services/session';

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
            // Remove a sessão inteira (access + refresh) e redireciona — sem limpar o
            // refresh token aqui, a sessão de longa duração sobreviveria à exclusão da conta.
            clearSession('user');
            setTimeout(() => navigate('/'), 2000);
        } catch (error) {
            addToast('Falha ao excluir (API offline)', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-surface border-b border-line sticky top-0 z-panel">
                <button
                    type="button"
                    onClick={() => navigate('/profile')}
                    aria-label="Voltar"
                    className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center active:scale-95 transition-transform"
                >
                    <i className="ri-arrow-left-line text-2xl text-ink-900" aria-hidden="true"></i>
                </button>
                <h2 className="text-xl font-semibold flex-1 text-danger-600">Excluir Conta</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
                <div className="bg-danger-50 border border-danger-500/20 rounded-panel p-4 flex gap-3 mb-6">
                    <i className="ri-error-warning-fill text-2xl text-danger-500 mt-0.5" aria-hidden="true"></i>
                    <div>
                        <h3 className="font-bold text-danger-700 mb-1">Ação irreversível</h3>
                        <p className="text-sm text-danger-600">Ao deletar sua conta, todo o seu histórico de viagens, cupons, saldo na carteira e cartões salvos serão perdidos permanentemente.</p>
                    </div>
                </div>

                <div className="mb-6">
                    <label className="font-semibold text-ink-900 mb-2 block">
                        Para confirmar, digite <span className="font-bold text-danger-500 uppercase tracking-widest bg-danger-50 px-2 py-0.5 rounded">EXCLUIR</span> abaixo:
                    </label>
                    <input
                        type="text"
                        placeholder="EXCLUIR"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        className="w-full bg-surface border border-line px-4 py-3 rounded-panel outline-none focus:border-danger-500 font-bold uppercase tracking-widest text-danger-600 placeholder-ink-400/50 text-center"
                    />
                </div>

                {confirmText === 'EXCLUIR' && (
                    <div className="animate-fade-in">
                        <label className="font-semibold text-ink-900 mb-2 block">
                            Digite sua senha para finalizar:
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Sua senha atual"
                                className="w-full bg-surface border border-line pl-4 pr-12 py-3 rounded-panel outline-none focus:border-danger-500 font-medium text-ink-900"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400"
                            >
                                <i className={`ri-eye-${showPassword ? 'off-' : ''}line text-lg`} aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-5 bg-surface border-t border-line pb-10">
                <Button
                    variant="dangerSolid"
                    onClick={handleDelete}
                    disabled={!isButtonEnabled}
                    loading={loading}
                >
                    Sim, excluir minha conta
                </Button>
            </div>
        </div>
    );
};

export default DeleteAccount;
