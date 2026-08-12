import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/shared/services/axios';
import { useToast } from '@/shared/contexts/ToastContext';
import Button from '@/shared/components/ui/Button';
import { clearSession } from '@/shared/services/session';

const DeleteAccount = () => {
    const navigate = useNavigate();
    const { addToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const isButtonEnabled = confirmText.trim().toUpperCase() === 'EXCLUIR';

    const handleDelete = async () => {
        setLoading(true);
        try {
            await api.post('/users/account-deletion', { confirmation: 'EXCLUIR' });
            clearSession('user');
            addToast('Conta desativada. A remoção dos dados ocorrerá em até 30 dias.', 'success');
            navigate('/login', { replace: true });
        } catch (error) {
            addToast(error.response?.data?.message || 'Não foi possível solicitar a exclusão.', 'error');
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
                        <h3 className="font-bold text-danger-700 mb-1">Sua conta será desativada agora</h3>
                        <p className="text-sm text-danger-600">As sessões serão encerradas imediatamente. Seus dados pessoais serão apagados ou anonimizados em até 30 dias, exceto quando a conservação for necessária por segurança ou obrigação legal.</p>
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

                <p className="text-sm text-ink-600 leading-6">Se houver corrida ou encomenda ativa, finalize ou cancele o serviço antes de continuar. Esta solicitação não poderá ser desfeita pelo aplicativo.</p>
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
