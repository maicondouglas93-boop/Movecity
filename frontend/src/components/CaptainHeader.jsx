import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const CaptainHeader = () => {
    const location = useLocation();

    return (
        <div className="fixed top-0 left-0 w-full bg-white border-b border-gray-200 z-[60] px-2 pt-4 pb-2 flex justify-between items-center shadow-sm">
            <Link 
                to="/captain-home" 
                className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/captain-home' ? 'text-black font-semibold' : 'text-gray-500 hover:text-gray-800'}`}
            >
                <div className={location.pathname === '/captain-home' ? 'bg-gray-200 px-3 py-1 rounded-full' : 'px-3 py-1'}>
                    <i className="ri-home-5-fill text-xl"></i>
                </div>
                <span className="text-[10px]">Início</span>
            </Link>

            <Link 
                to="/captain/rides" 
                className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/captain/rides' ? 'text-black font-semibold' : 'text-gray-500 hover:text-gray-800'}`}
            >
                <div className={location.pathname === '/captain/rides' ? 'bg-gray-200 px-3 py-1 rounded-full' : 'px-3 py-1'}>
                    <i className="ri-car-fill text-xl"></i>
                </div>
                <span className="text-[10px]">Corridas</span>
            </Link>

            <Link 
                to="/captain-wallet" 
                className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/captain-wallet' ? 'text-black font-semibold' : 'text-gray-500 hover:text-gray-800'}`}
            >
                <div className={location.pathname === '/captain-wallet' ? 'bg-gray-200 px-3 py-1 rounded-full' : 'px-3 py-1'}>
                    <i className="ri-wallet-3-fill text-xl"></i>
                </div>
                <span className="text-[10px]">Carteira</span>
            </Link>

            <Link 
                to="/captain/earnings" 
                className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/captain/earnings' ? 'text-black font-semibold' : 'text-gray-500 hover:text-gray-800'}`}
            >
                <div className={location.pathname === '/captain/earnings' ? 'bg-gray-200 px-3 py-1 rounded-full' : 'px-3 py-1'}>
                    <i className="ri-bar-chart-fill text-xl"></i>
                </div>
                <span className="text-[10px]">Ganhos</span>
            </Link>

            <Link 
                to="/captain/profile" 
                className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${location.pathname === '/captain/profile' ? 'text-black font-semibold' : 'text-gray-500 hover:text-gray-800'}`}
            >
                <div className={location.pathname === '/captain/profile' ? 'bg-gray-200 px-3 py-1 rounded-full' : 'px-3 py-1'}>
                    <i className="ri-user-3-fill text-xl"></i>
                </div>
                <span className="text-[10px]">Perfil</span>
            </Link>
        </div>
    );
}

export default CaptainHeader;
