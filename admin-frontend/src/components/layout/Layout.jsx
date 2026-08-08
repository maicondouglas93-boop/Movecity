import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';

// Responsividade (2026-08-08, CSS-only): sidebar vira off-canvas abaixo de md:,
// controlada por este estado local — mesmo padrão de menuOpen já usado no header
// do passageiro (frontend/src/passenger/components/Header.jsx). Nenhuma lógica de
// dados/permissão muda, só a interação de abrir/fechar o próprio menu.
export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto">
        <div className="flex items-center gap-3 p-4 border-b border-border md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
            className="p-1.5 -ml-1.5 rounded-lg text-text-muted hover:bg-border/50 hover:text-text"
          >
            <Menu className="w-6 h-6" />
          </button>
          <h1 className="text-base font-bold text-primary tracking-tight">MoveCity Admin</h1>
        </div>
        <div className="p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
