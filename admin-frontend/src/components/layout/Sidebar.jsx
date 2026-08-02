import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Car, Map, CreditCard,
  Bell, LogOut, Receipt, FileText, ClipboardList, Tag,
  BarChart3
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// Bloco G (2026-08-02, achado S2): espelha exatamente allowedRoles de App.jsx, que por
// sua vez espelha as restrições reais de Backend/routes/admin.routes.js. `roles: undefined`
// = leitura aberta a qualquer papel autenticado (mesmo critério usado em App.jsx).
// "Configurações" foi removido daqui — linkava pra uma rota (/settings) que nunca existiu.
const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Map, label: 'Corridas & Mapa', path: '/rides' },
  { icon: Users, label: 'Passageiros', path: '/users' },
  { icon: Car, label: 'Motoristas', path: '/captains' },
  { icon: CreditCard, label: 'Financeiro', path: '/finance', roles: ['super_admin', 'financeiro'] },
  { icon: Receipt, label: 'Tarifas', path: '/tariffs' },
  { icon: Tag, label: 'Cupons', path: '/promotions', roles: ['super_admin', 'operador'] },
  { icon: BarChart3, label: 'Relatórios & BI', path: '/reports', roles: ['super_admin'] },
  { icon: Bell, label: 'Notificações', path: '/notifications', roles: ['super_admin', 'operador'] },
  { icon: ClipboardList, label: 'Logs & Auditoria', path: '/logs', roles: ['super_admin'] },
];

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="w-64 bg-surface border-r border-border min-h-screen flex flex-col">
      <div className="p-6">
        <h2 className="text-xl font-bold text-primary tracking-tight">MoveCity Admin</h2>
        <p className="text-xs text-text-muted mt-1">{user?.role?.toUpperCase()}</p>
      </div>

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          // OWNER é quem o backend sempre deixa passar (authorizeRoles), não super_admin.
          if (item.roles && user?.role !== 'OWNER' && !item.roles.includes(user?.role)) return null;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium
                ${isActive 
                  ? 'bg-primary/10 text-primary' 
                  : 'text-text-muted hover:bg-border/50 hover:text-text'}
              `}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-muted hover:bg-danger/10 hover:text-danger transition-colors w-full"
        >
          <LogOut className="w-5 h-5" />
          Sair do Sistema
        </button>
      </div>
    </aside>
  );
}
