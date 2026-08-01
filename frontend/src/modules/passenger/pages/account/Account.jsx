import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/modules/passenger/components/Header';
import { UserDataContext } from '@/contexts/UserContext';

const Account = () => {
    const { user } = useContext(UserDataContext);
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-white flex flex-col pt-24 pb-6 font-sans">
            <div className="p-5 flex items-center justify-between bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <div className="h-16 w-16 bg-white rounded-full flex items-center justify-center overflow-hidden border-2 border-green-200 shadow-sm">
                            {user?.profilePicture ? (
                                <img src={user.profilePicture} alt="Profile" className="h-full w-full object-cover" />
                            ) : (
                                <i className="ri-user-fill text-3xl text-green-500"></i>
                            )}
                        </div>
                        <div className="absolute bottom-0 right-0 bg-green-500 rounded-full h-6 w-6 flex items-center justify-center shadow-sm cursor-pointer" onClick={() => navigate('/profile')}>
                            <i className="ri-pencil-fill text-xs text-white"></i>
                        </div>
                    </div>
                    <h2 className="text-xl font-semibold capitalize text-gray-800">
                        {user?.fullname?.firstname || 'Visitante'} {user?.fullname?.lastname || ''}
                    </h2>
                </div>
            </div>

            <div className="mt-2 bg-white flex-1 overflow-y-auto">
                <ul className="flex flex-col">
                    <li onClick={() => navigate('/profile')} className="flex items-center justify-between p-4 border-b border-gray-100 cursor-pointer active:bg-green-50 transition-colors">
                        <div className="flex items-center gap-4">
                            <i className="ri-user-3-fill text-xl text-green-500"></i>
                            <span className="font-medium text-gray-800">Meus dados</span>
                        </div>
                        <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                    </li>
                    {/* Cupons, Cartões, Agendadas e Favoritos escondidos até existir backend real
                        (rotas /coupons /cards /scheduled /favorites e a carteira do passageiro
                        continuam implementadas, só não estão linkadas daqui — ver A7 na auditoria) */}
                    <li onClick={() => navigate('/help')} className="flex items-center justify-between p-4 border-b border-gray-100 cursor-pointer active:bg-green-50 transition-colors">
                        <div className="flex items-center gap-4">
                            <i className="ri-lifebuoy-fill text-xl text-green-500"></i>
                            <span className="font-medium text-gray-800">Ajuda</span>
                        </div>
                        <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                    </li>
                    <li 
                        onClick={() => navigate('/user/logout')}
                        className="flex items-center justify-between p-4 cursor-pointer active:bg-red-50 text-red-500 transition-colors mt-2"
                    >
                        <div className="flex items-center gap-4">
                            <i className="ri-logout-box-r-line text-xl"></i>
                            <span className="font-medium">Sair</span>
                        </div>
                    </li>
                </ul>
            </div>
            
            <Header />
        </div>
    );
}

export default Account;
