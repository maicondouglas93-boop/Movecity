import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/passenger/components/Header';
import { UserDataContext } from '@/passenger/contexts/UserContext';
import DetailRow from '@/shared/components/ui/DetailRow';

const Account = () => {
    const { user } = useContext(UserDataContext);
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-surface flex flex-col pt-24 pb-6 font-sans">
            <div className="p-5 flex items-center justify-between bg-surface-alt border-b border-line">
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <div className="h-16 w-16 bg-surface rounded-full flex items-center justify-center overflow-hidden border-2 border-brand-200 shadow-raised">
                            {user?.profilePicture ? (
                                <img src={user.profilePicture} alt="Profile" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                                <i className="ri-user-fill text-3xl text-brand-500" aria-hidden="true"></i>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => navigate('/profile')}
                            aria-label="Editar perfil"
                            className="absolute bottom-0 right-0 bg-brand-500 rounded-full h-6 w-6 flex items-center justify-center shadow-raised"
                        >
                            <i className="ri-pencil-fill text-xs text-white" aria-hidden="true"></i>
                        </button>
                    </div>
                    <h2 className="text-xl font-semibold capitalize text-ink-900">
                        {user?.fullname?.firstname || 'Visitante'} {user?.fullname?.lastname || ''}
                    </h2>
                </div>
            </div>

            <div className="mt-2 bg-surface flex-1 overflow-y-auto divide-y divide-line">
                <DetailRow
                    icon="ri-user-3-fill"
                    title="Meus dados"
                    onClick={() => navigate('/profile')}
                    trailing={<i className="ri-arrow-right-s-line text-xl text-ink-400" aria-hidden="true"></i>}
                    className="px-4"
                />
                {/* Cupons, Cartões, Agendadas e Favoritos escondidos até existir backend real
                    (rotas /coupons /cards /scheduled /favorites e a carteira do passageiro
                    continuam implementadas, só não estão linkadas daqui — ver A7 na auditoria) */}
                <DetailRow
                    icon="ri-lifebuoy-fill"
                    title="Ajuda"
                    onClick={() => navigate('/help')}
                    trailing={<i className="ri-arrow-right-s-line text-xl text-ink-400" aria-hidden="true"></i>}
                    className="px-4"
                />
                <DetailRow
                    icon="ri-logout-box-r-line"
                    iconColor="text-danger-500"
                    title={<span className="text-danger-500 font-semibold">Sair</span>}
                    onClick={() => navigate('/user/logout')}
                    className="px-4 mt-2"
                />
            </div>

            <Header />
        </div>
    );
}

export default Account;
