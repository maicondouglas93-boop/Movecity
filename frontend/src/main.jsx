import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import WebAppProviders from '@/shared/bootstrap/WebAppProviders'
import AppErrorBoundary from '@/shared/components/AppErrorBoundary'
import { initMonitoring } from '@/shared/bootstrap/initMonitoring'

initMonitoring()

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <WebAppProviders>
      <App />
    </WebAppProviders>
  </AppErrorBoundary>
)
