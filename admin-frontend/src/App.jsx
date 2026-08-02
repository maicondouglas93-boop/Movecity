import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Unauthorized from './pages/Unauthorized';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Captains from './pages/Captains';
import Rides from './pages/Rides';
import Finance from './pages/Finance';
import Tariffs from './pages/Tariffs';
import Logs from './pages/Logs';
import Notifications from './pages/Notifications';
import Promotions from './pages/Promotions';
import Reports from './pages/Reports';

function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/users" element={<Users />} />
              <Route path="/captains" element={<Captains />} />
              <Route path="/rides" element={<Rides />} />
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

          <Route element={<ProtectedRoute allowedRoles={['super_admin', 'operador']} />}>
            <Route element={<Layout />}>
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/promotions" element={<Promotions />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
            <Route element={<Layout />}>
              <Route path="/logs" element={<Logs />} />
              <Route path="/reports" element={<Reports />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
