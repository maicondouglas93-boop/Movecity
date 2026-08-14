import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { useToast } from './contexts/ToastContext';
import { onAdminForegroundMessage } from './services/fcm';
import { ProtectedRoute } from './components/ProtectedRoute';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Unauthorized from './pages/Unauthorized';

// Bloco J (2026-08-02, achado R29): as 11 páginas eram importadas estaticamente — o
// bundle inicial (1,24MB) carregava Leaflet e Recharts mesmo pra quem só abre o
// Dashboard. Login/Unauthorized ficam eager (tela de entrada, não valem a divisão).
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Users = lazy(() => import('./pages/Users'));
const Captains = lazy(() => import('./pages/Captains'));
const Rides = lazy(() => import('./pages/Rides'));
const Finance = lazy(() => import('./pages/Finance'));
const Tariffs = lazy(() => import('./pages/Tariffs'));
const Parcels = lazy(() => import('./pages/Parcels'));
const Logs = lazy(() => import('./pages/Logs'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Promotions = lazy(() => import('./pages/Promotions'));
const Reports = lazy(() => import('./pages/Reports'));
const ServicesMonitoring = lazy(() => import('./pages/ServicesMonitoring'));
const DriverAppUpdate = lazy(() => import('./pages/DriverAppUpdate'));

const PageLoading = () => (
  <div className="min-h-[50vh] flex items-center justify-center text-text-muted text-sm">Carregando...</div>
);

function App() {
  const toast = useToast();

  // A9/Fase 7 da correção do sistema de push (2026-08-02): com o painel aberto, o
  // Firebase não mostra notificação nativa sozinho — sem isto, um alerta administrativo
  // (novo motorista, denúncia, problema de pagamento) só apareceria se o admin
  // recarregasse a tela ou fosse conferir a aba correspondente por conta própria.
  useEffect(() => {
    const unsubscribe = onAdminForegroundMessage((payload) => {
      const title = payload?.notification?.title || payload?.data?.title;
      const body = payload?.notification?.body || payload?.data?.message;
      if (title || body) {
        toast.success([title, body].filter(Boolean).join(' — '));
      }
    });
    return () => unsubscribe();
  }, [toast]);

  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
        <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/users" element={<Users />} />
              <Route path="/captains" element={<Captains />} />
              <Route path="/rides" element={<Rides />} />
              <Route path="/parcels" element={<Parcels />} />
              <Route path="/tariffs" element={<Tariffs />} />
            </Route>
          </Route>

          {/* Bloco G (2026-08-02, achado S2): allowedRoles espelha exatamente as
              restrições que Backend/routes/admin.routes.js já aplica em cada seção —
              ver a tabela em docs/plans/2026-08-02-execucao-bloco-g-admin-papeis.md.
              Sem isso, um admin com papel restrito navegava até a tela e só descobria
              que não podia fazer nada quando toda ação retornava 403. */}
          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'financeiro']} />}>
            <Route element={<Layout />}>
              <Route path="/finance" element={<Finance />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'operador', 'marketing']} />}>
            <Route element={<Layout />}>
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/promotions" element={<Promotions />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
            <Route element={<Layout />}>
              <Route path="/logs" element={<Logs />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/monitoring" element={<ServicesMonitoring />} />
              <Route path="/driver-app" element={<DriverAppUpdate />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
