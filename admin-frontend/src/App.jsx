import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
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
          
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/users" element={<Users />} />
              <Route path="/captains" element={<Captains />} />
              <Route path="/rides" element={<Rides />} />
              
              {/* Rotas restritas podem usar Wrapper de Roles depois, por hora ProtectedRoute cuida global */}
              <Route path="/finance" element={<Finance />} />
              <Route path="/tariffs" element={<Tariffs />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/promotions" element={<Promotions />} />
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
