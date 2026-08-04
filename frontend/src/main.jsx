import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { BrowserRouter } from 'react-router-dom';
import UserContext from '@/passenger/contexts/UserContext';
import CaptainContext from '@/driver/contexts/CaptainContext';
import SocketProvider from '@/shared/contexts/SocketContext';
import { LocationProvider } from '@/shared/contexts/LocationContext';
import { ToastProvider } from '@/shared/contexts/ToastContext';
import RideProvider from '@/shared/contexts/RideContext';

import * as Sentry from "@sentry/react";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 1.0,
    tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}

import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/shared/services/queryClient';

createRoot(document.getElementById('root')).render(

  <QueryClientProvider client={queryClient}>
    <CaptainContext>
      <UserContext>
        <ToastProvider>
          <SocketProvider>
            <LocationProvider>
              {/* RideProvider precisa do BrowserRouter (usa useNavigate/useLocation
                  pra restaurar a tela certa de uma corrida ativa) e do SocketProvider
                  (re-sincroniza a corrida no 'connect'). */}
              <BrowserRouter>
                <RideProvider>
                  <App />
                </RideProvider>
              </BrowserRouter>
            </LocationProvider>
          </SocketProvider>
        </ToastProvider>
      </UserContext>
    </CaptainContext>
  </QueryClientProvider>

)
