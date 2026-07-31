import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const Header = () => {
    const location = useLocation();
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <>
            <div className="fixed top-0 left-0 w-full bg-white border-b border-gray-200 z-[60] px-4 pt-3 pb-2 flex justify-between items-center shadow-sm">
                <Link to="/home" className="flex items-center">
                    <img className='h-12 object-contain' src="/movecity-logo.png" alt="MoveCity" />
                </Link>
                <button onClick={() => setMenuOpen(true)} className="text-gray-700 hover:text-green-600 p-1 text-2xl transition-colors">
                    <i className="ri-menu-line"></i>
                </button>
            </div>

            {menuOpen && (
                <>
                    {/* Transparent overlay to close the dropdown when clicking outside */}
                    <div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)}></div>
                    
                    {/* Dropdown Menu (Balãozinho) */}
                    <div 
                        className="fixed top-16 right-4 w-48 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 z-[70] overflow-hidden animate-slide-in-right origin-top-right"
                        style={{ animation: 'none', transformOrigin: 'top right' }} 
                        // Removing the slide-in right, or maybe use a scale/fade in animation, but standard Tailwind has no scale-in utility. We can just render it.
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex flex-col py-2">
                            <Link onClick={() => setMenuOpen(false)} to="/home" className="px-5 py-3 flex items-center gap-3 text-gray-700 hover:bg-green-50 hover:text-green-600 transition-colors text-sm font-medium">
                                <i className="ri-home-5-line text-lg text-gray-400"></i> Início
                            </Link>
                            <Link onClick={() => setMenuOpen(false)} to="/activity" className="px-5 py-3 flex items-center gap-3 text-gray-700 hover:bg-green-50 hover:text-green-600 transition-colors text-sm font-medium">
                                <i className="ri-history-line text-lg text-gray-400"></i> Histórico
                            </Link>
                            <Link onClick={() => setMenuOpen(false)} to="/account" className="px-5 py-3 flex items-center gap-3 text-gray-700 hover:bg-green-50 hover:text-green-600 transition-colors text-sm font-medium">
                                <i className="ri-user-3-line text-lg text-gray-400"></i> Conta
                            </Link>
                            <div className="h-px bg-gray-100 my-1 mx-2"></div>
                            <Link onClick={() => setMenuOpen(false)} to="/user/logout" className="px-5 py-3 flex items-center gap-3 text-red-500 hover:bg-red-50 transition-colors text-sm font-medium">
                                <i className="ri-logout-box-r-line text-lg text-red-400"></i> Sair
                            </Link>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

export default Header;
