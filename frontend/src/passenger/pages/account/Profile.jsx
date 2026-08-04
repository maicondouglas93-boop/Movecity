import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/shared/components/ui/PageHeader';
import DetailRow from '@/shared/components/ui/DetailRow';

const Profile = () => {
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Minha Conta" onBack={() => navigate('/account')} />

            <div className="flex-1 overflow-y-auto">
                {/* Perfil */}
                <div className="pt-4 px-4 pb-2">
                    <span className="text-xs font-bold text-ink-400 uppercase tracking-wider ml-1">Perfil</span>
                </div>
                <div className="bg-surface border-y border-line mb-4">
                    <DetailRow
                        icon="ri-profile-line"
                        title="Dados pessoais"
                        subtitle="Nome, contato, documento e foto"
                        onClick={() => navigate('/profile/personal-data')}
                        trailing={<i className="ri-arrow-right-s-line text-2xl text-ink-400" aria-hidden="true"></i>}
                        className="px-4"
                    />
                </div>

                {/* Segurança */}
                <div className="pt-4 px-4 pb-2">
                    <span className="text-xs font-bold text-ink-400 uppercase tracking-wider ml-1">Segurança</span>
                </div>
                <div className="bg-surface border-y border-line mb-4 divide-y divide-line">
                    <DetailRow
                        icon="ri-lock-password-line"
                        title="Alterar senha"
                        subtitle="Mantenha sua conta segura"
                        onClick={() => navigate('/profile/change-password')}
                        trailing={<i className="ri-arrow-right-s-line text-2xl text-ink-400" aria-hidden="true"></i>}
                        className="px-4"
                    />
                    <DetailRow
                        icon="ri-history-line"
                        iconColor="text-ink-400"
                        title={
                            <span className="flex items-center gap-2">
                                Sessões ativas <span className="bg-surface-alt text-ink-400 text-[10px] px-2 py-0.5 rounded-md font-bold uppercase">Em breve</span>
                            </span>
                        }
                        subtitle="Veja onde você está logado"
                        className="px-4 opacity-60"
                    />
                    <DetailRow
                        icon="ri-smartphone-line"
                        iconColor="text-ink-400"
                        title={
                            <span className="flex items-center gap-2">
                                Dispositivos conectados <span className="bg-surface-alt text-ink-400 text-[10px] px-2 py-0.5 rounded-md font-bold uppercase">Em breve</span>
                            </span>
                        }
                        subtitle="Gerencie celulares aprovados"
                        className="px-4 opacity-60"
                    />
                </div>

                {/* Sobre */}
                <div className="pt-4 px-4 pb-2">
                    <span className="text-xs font-bold text-ink-400 uppercase tracking-wider ml-1">Sobre</span>
                </div>
                <div className="bg-surface border-y border-line mb-6 divide-y divide-line">
                    <DetailRow
                        icon="ri-file-text-line"
                        title="Termos de uso"
                        onClick={() => navigate('/profile/terms')}
                        trailing={<i className="ri-arrow-right-s-line text-2xl text-ink-400" aria-hidden="true"></i>}
                        className="px-4"
                    />
                    <DetailRow
                        icon="ri-shield-check-fill"
                        title="Política de privacidade"
                        onClick={() => navigate('/profile/privacy')}
                        trailing={<i className="ri-arrow-right-s-line text-2xl text-ink-400" aria-hidden="true"></i>}
                        className="px-4"
                    />
                </div>

                {/* Zona de Perigo */}
                <div className="px-4 pb-8">
                    <div className="bg-surface border border-danger-500/20 rounded-panel">
                        <DetailRow
                            icon="ri-delete-bin-line"
                            iconColor="text-danger-500"
                            title={<span className="text-danger-600">Excluir conta</span>}
                            onClick={() => navigate('/profile/delete-account')}
                            trailing={<i className="ri-arrow-right-s-line text-2xl text-danger-300" aria-hidden="true"></i>}
                            className="px-4"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Profile;
