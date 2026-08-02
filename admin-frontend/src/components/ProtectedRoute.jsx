import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const ProtectedRoute = ({ allowedRoles }) => {
  const { user, loading } = useAuth();

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-background text-text">Carregando...</div>;

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Bloco G (2026-08-02, achado S2): allowedRoles existia mas nenhuma rota o usava.
  // OWNER (não super_admin) é quem o backend sempre deixa passar — ver authorizeRoles
  // em Backend/middlewares/adminAuth.middleware.js.
  if (allowedRoles && user.role !== 'OWNER' && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
};
