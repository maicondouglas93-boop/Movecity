import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePwaUpdate } from '@/contexts/PwaUpdateContext';
import { useToast } from '@/contexts/ToastContext';

const Header = () => {
    const location = useLocation();
    const [menuOpen, setMenuOpen] = useState(false);
    const { checkForUpdate, updateServiceWorker } = usePwaUpdate();
    const { addToast } = useToast();

    // Botão manual de atualização (2026-08-04): força checagem do SW e aplica na hora.
    // Corrigido no mesmo dia: com autoUpdate o check nunca via update nova e o toast
    // falso "já atualizado" fazia a pessoa limpar o cache na mão.
    const handleUpdateClick = async () => {
        setMenuOpen(false);
        addToast('Procurando atualização...', 'info');
        const found = await checkForUpdate();
        if (found) {
            addToast('Atualizando o app...', 'info');
            await updateServiceWorker(true);
            // Fallback se o plugin não recarregar (rede lenta / SW travado em waiting).
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            addToast('Você já está na versão mais recente.', 'success');
        }
    };

    return (
        <>
            <div className="fixed top-0 left-0 w-full bg-surface border-b border-line z-[60] px-4 pt-3 pb-2 flex justify-between items-center shadow-raised">
                <Link to="/home" className="flex items-center">
                    <img className='h-12 object-contain' src="/movecity-logo.png" alt="MoveCity" width="500" height="500" />
                </Link>
                <button
                    type="button"
                    onClick={() => setMenuOpen(true)}
                    aria-label="Abrir menu"
                    className="text-ink-600 active:text-brand-600 p-1 text-2xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                    <i className="ri-menu-line" aria-hidden="true"></i>
                </button>
            </div>

            {menuOpen && (
                <>
                    {/* Overlay transparente pra fechar o menu ao clicar fora */}
                    <div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)}></div>

                    {/* Dropdown Menu (Balãozinho) */}
                    <div
                        className="fixed top-16 right-4 w-48 bg-surface rounded-panel shadow-floating border border-line z-[70] overflow-hidden origin-top-right"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex flex-col py-2">
                            <Link onClick={() => setMenuOpen(false)} to="/home" className="px-5 py-3 flex items-center gap-3 text-ink-600 active:bg-brand-50 active:text-brand-700 transition-colors text-sm font-medium">
                                <i className="ri-home-5-line text-lg text-ink-400" aria-hidden="true"></i> Início
                            </Link>
                            <Link onClick={() => setMenuOpen(false)} to="/activity" className="px-5 py-3 flex items-center gap-3 text-ink-600 active:bg-brand-50 active:text-brand-700 transition-colors text-sm font-medium">
                                <i className="ri-history-line text-lg text-ink-400" aria-hidden="true"></i> Histórico
                            </Link>
                            <Link onClick={() => setMenuOpen(false)} to="/account" className="px-5 py-3 flex items-center gap-3 text-ink-600 active:bg-brand-50 active:text-brand-700 transition-colors text-sm font-medium">
                                <i className="ri-user-3-line text-lg text-ink-400" aria-hidden="true"></i> Conta
                            </Link>
                            <div className="h-px bg-line my-1 mx-2"></div>
                            <button
                                type="button"
                                onClick={handleUpdateClick}
                                className="px-5 py-3 flex items-center gap-3 text-ink-600 active:bg-brand-50 active:text-brand-700 transition-colors text-sm font-medium text-left"
                            >
                                <i className="ri-refresh-line text-lg text-ink-400" aria-hidden="true"></i> Atualizar app
                            </button>
                            <div className="h-px bg-line my-1 mx-2"></div>
                            <Link onClick={() => setMenuOpen(false)} to="/user/logout" className="px-5 py-3 flex items-center gap-3 text-danger-500 active:bg-danger-50 transition-colors text-sm font-medium">
                                <i className="ri-logout-box-r-line text-lg text-danger-500" aria-hidden="true"></i> Sair
                            </Link>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

export default Header;
