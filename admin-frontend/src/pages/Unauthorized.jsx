import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// Bloco G (2026-08-02, achado S2): antes, ProtectedRoute redirecionava pra cá em caso
// de papel sem permissão, mas a rota não existia — caía no catch-all e voltava pro
// Dashboard sem nenhuma explicação do que aconteceu.
export default function Unauthorized() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md bg-surface border border-border p-8 rounded-xl shadow-2xl text-center space-y-4">
        <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mx-auto">
          <ShieldAlert className="w-8 h-8 text-danger" />
        </div>
        <h1 className="text-xl font-bold text-text">Acesso não permitido</h1>
        <p className="text-sm text-text-muted">
          Seu papel atual ({user?.role || 'desconhecido'}) não tem permissão para acessar esta área do painel.
          Se você acredita que deveria ter acesso, fale com um administrador.
        </p>
        <Link
          to="/dashboard"
          className="inline-block bg-primary hover:bg-primary-hover text-surface px-6 py-2 rounded-lg font-medium transition-colors"
        >
          Voltar ao Dashboard
        </Link>
      </div>
    </div>
  );
}
