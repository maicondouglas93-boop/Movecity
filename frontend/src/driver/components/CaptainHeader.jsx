import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePwaUpdate } from '@/shared/contexts/PwaUpdateContext';
import { useToast } from '@/shared/contexts/ToastContext';
import InstallAppButton from '@/shared/components/ui/InstallAppButton';
import NotificationBell from '@/shared/components/NotificationBell';

// Links do motorista consolidados num menu hamburguer (2026-08-04) — a barra de 5
// ícones fixa no topo brigava com o espaço da tela em telas pequenas e duplicava o
// papel de um menu (nenhuma delas era usada com frequência suficiente pra justificar
// ficar sempre visível). Mesmo padrão do Header.jsx do passageiro, pra manter as duas
// pontas do app consistentes.
const NAV_LINKS = [
    { to: '/captain-home', label: 'Início', icon: 'ri-home-5-line' },
    { to: '/captain/scheduled', label: 'Agendados', icon: 'ri-calendar-event-line' },
    { to: '/captain/rides', label: 'Corridas', icon: 'ri-car-line' },
    { to: '/captain/parcels', label: 'Encomendas', icon: 'ri-box-3-line' },
    { to: '/captain-wallet', label: 'Carteira', icon: 'ri-wallet-3-line' },
    { to: '/captain/earnings', label: 'Ganhos', icon: 'ri-bar-chart-line' },
    { to: '/captain/profile', label: 'Perfil', icon: 'ri-user-3-line' },
];

const CaptainHeader = () => {
    const location = useLocation();
    const [menuOpen, setMenuOpen] = useState(false);
    const { checkForUpdate, updateServiceWorker } = usePwaUpdate();
    const { addToast } = useToast();

    // Botão manual de atualização (2026-08-04) — ver o mesmo em Header.jsx (passageiro).
    const handleUpdateClick = async () => {
        setMenuOpen(false);
        addToast('Procurando atualização...', 'info');
        const found = await checkForUpdate();
        if (found) {
            addToast('Atualizando o app...', 'info');
            await updateServiceWorker(true);
            // Fase 3 (M1, 2026-08-05): sem cleanup de propósito — ver comentário
            // equivalente em Header.jsx (reload é ação global de aplicar o SW novo).
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            addToast('Você já está na versão mais recente.', 'success');
        }
    };

    return (
        <>
            <div className="fixed top-0 left-0 w-full bg-surface border-b border-line z-[60] px-4 pt-3 pb-2 flex justify-between items-center shadow-raised gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <Link to="/captain-home" className="flex items-center min-w-0">
                        <img className='h-12 object-contain' src="/movecity-logo.png" alt="MoveCity" width="500" height="500" />
                    </Link>
                    <InstallAppButton />
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                    <NotificationBell to="/captain/notifications" />
                    <button
                        type="button"
                        onClick={() => setMenuOpen(true)}
                        aria-label="Abrir menu"
                        className="text-ink-600 active:text-brand-600 p-1 text-2xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
                    >
                        <i className="ri-menu-line" aria-hidden="true"></i>
                    </button>
                </div>
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
                            {NAV_LINKS.map(({ to, label, icon }) => {
                                const isActive = location.pathname === to;
                                return (
                                    <Link
                                        key={to}
                                        onClick={() => setMenuOpen(false)}
                                        to={to}
                                        className={`px-5 py-3 flex items-center gap-3 transition-colors text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 active:bg-brand-50 active:text-brand-700'}`}
                                    >
                                        <i className={`${icon} text-lg ${isActive ? 'text-brand-600' : 'text-ink-400'}`} aria-hidden="true"></i> {label}
                                    </Link>
                                );
                            })}
                            <div className="h-px bg-line my-1 mx-2"></div>
                            <button
                                type="button"
                                onClick={handleUpdateClick}
                                className="px-5 py-3 flex items-center gap-3 text-ink-600 active:bg-brand-50 active:text-brand-700 transition-colors text-sm font-medium text-left"
                            >
                                <i className="ri-refresh-line text-lg text-ink-400" aria-hidden="true"></i> Atualizar app
                            </button>
                            <div className="h-px bg-line my-1 mx-2"></div>
                            <Link onClick={() => setMenuOpen(false)} to="/captain/logout" className="px-5 py-3 flex items-center gap-3 text-danger-500 active:bg-danger-50 transition-colors text-sm font-medium">
                                <i className="ri-logout-box-r-line text-lg text-danger-500" aria-hidden="true"></i> Sair
                            </Link>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

export default CaptainHeader;
