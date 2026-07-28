import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const Header = () => {
    const location = useLocation();

    return (
        <div className="fixed top-0 left-0 w-full bg-white border-b border-gray-200 z-[60] px-4 pt-3 pb-2 flex justify-between items-center shadow-sm">
            <img className='h-16 object-contain' src="/movecity-logo.png" alt="MoveCity" />
            <div className="flex gap-1">
                <Link 
                    to="/home" 
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/home' ? 'text-green-600 font-semibold' : 'text-gray-400 hover:text-green-500'}`}
                >
                    <div className={location.pathname === '/home' ? 'bg-green-50 px-3 py-1 rounded-full' : 'px-3 py-1'}>
                        <i className="ri-home-5-fill text-xl"></i>
                    </div>
                    <span className="text-[10px]">Início</span>
                </Link>

                <Link 
                    to="/activity" 
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/activity' ? 'text-green-600 font-semibold' : 'text-gray-400 hover:text-green-500'}`}
                >
                    <div className={location.pathname === '/activity' ? 'bg-green-50 px-3 py-1 rounded-full' : 'px-3 py-1'}>
                        <i className="ri-history-line text-xl"></i>
                    </div>
                    <span className="text-[10px]">Atividade</span>
                </Link>

                <Link 
                    to="/account" 
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/account' ? 'text-green-600 font-semibold' : 'text-gray-400 hover:text-green-500'}`}
                >
                    <div className={location.pathname === '/account' ? 'bg-green-50 px-3 py-1 rounded-full' : 'px-3 py-1'}>
                        <i className="ri-user-3-fill text-xl"></i>
                    </div>
                    <span className="text-[10px]">Conta</span>
                </Link>
            </div>
        </div>
    );
}

export default Header;
