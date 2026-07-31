import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { BrowserRouter } from 'react-router-dom';
import UserContext from '@/contexts/UserContext';
import CaptainContext from '@/contexts/CaptainContext';
import SocketProvider from '@/contexts/SocketContext';
import { LocationProvider } from '@/contexts/LocationContext';

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
import { queryClient } from '@/services/queryClient';

createRoot(document.getElementById('root')).render(

  <QueryClientProvider client={queryClient}>
    <CaptainContext>
      <UserContext>
        <SocketProvider>
          <LocationProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </LocationProvider>
        </SocketProvider>
      </UserContext>
    </CaptainContext>
  </QueryClientProvider>

)
