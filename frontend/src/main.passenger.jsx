import { createRoot } from 'react-dom/client'
import './index.css'
import AppPassenger from '@/App.passenger'
import PassengerAppProviders from '@/shared/bootstrap/PassengerAppProviders'
import AppErrorBoundary from '@/shared/components/AppErrorBoundary'
import { initMonitoring } from '@/shared/bootstrap/initMonitoring'

initMonitoring()

createRoot(document.getElementById('root')).render(
    <AppErrorBoundary>
        <PassengerAppProviders>
            <AppPassenger />
        </PassengerAppProviders>
    </AppErrorBoundary>
)
