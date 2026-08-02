import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const CaptainHeader = () => {
    const location = useLocation();

    return (
        <div className="fixed top-0 left-0 w-full bg-surface border-b border-line z-panel px-2 pt-4 pb-2 flex justify-between items-center shadow-raised">
            <Link
                to="/captain-home"
                className={`flex flex-col items-center gap-1 p-2 rounded-panel transition-all ${location.pathname === '/captain-home' ? 'text-ink-900 font-semibold' : 'text-ink-600 hover:text-ink-900'}`}
            >
                <div className={location.pathname === '/captain-home' ? 'bg-surface-alt px-3 py-1 rounded-full' : 'px-3 py-1'}>
                    <i className="ri-home-5-fill text-xl"></i>
                </div>
                <span className="text-xs">Início</span>
            </Link>

            <Link
                to="/captain/rides"
                className={`flex flex-col items-center gap-1 p-2 rounded-panel transition-all ${location.pathname === '/captain/rides' ? 'text-ink-900 font-semibold' : 'text-ink-600 hover:text-ink-900'}`}
            >
                <div className={location.pathname === '/captain/rides' ? 'bg-surface-alt px-3 py-1 rounded-full' : 'px-3 py-1'}>
                    <i className="ri-car-fill text-xl"></i>
                </div>
                <span className="text-xs">Corridas</span>
            </Link>

            <Link
                to="/captain-wallet"
                className={`flex flex-col items-center gap-1 p-2 rounded-panel transition-all ${location.pathname === '/captain-wallet' ? 'text-ink-900 font-semibold' : 'text-ink-600 hover:text-ink-900'}`}
            >
                <div className={location.pathname === '/captain-wallet' ? 'bg-surface-alt px-3 py-1 rounded-full' : 'px-3 py-1'}>
                    <i className="ri-wallet-3-fill text-xl"></i>
                </div>
                <span className="text-xs">Carteira</span>
            </Link>

            <Link
                to="/captain/earnings"
                className={`flex flex-col items-center gap-1 p-2 rounded-panel transition-all ${location.pathname === '/captain/earnings' ? 'text-ink-900 font-semibold' : 'text-ink-600 hover:text-ink-900'}`}
            >
                <div className={location.pathname === '/captain/earnings' ? 'bg-surface-alt px-3 py-1 rounded-full' : 'px-3 py-1'}>
                    <i className="ri-bar-chart-fill text-xl"></i>
                </div>
                <span className="text-xs">Ganhos</span>
            </Link>

            <Link
                to="/captain/profile"
                className={`flex flex-col items-center gap-1 p-2 rounded-panel transition-all ${location.pathname === '/captain/profile' ? 'text-ink-900 font-semibold' : 'text-ink-600 hover:text-ink-900'}`}
            >
                <div className={location.pathname === '/captain/profile' ? 'bg-surface-alt px-3 py-1 rounded-full' : 'px-3 py-1'}>
                    <i className="ri-user-3-fill text-xl"></i>
                </div>
                <span className="text-xs">Perfil</span>
            </Link>
        </div>
    );
}

export default CaptainHeader;
