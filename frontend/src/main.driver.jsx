import { createRoot } from 'react-dom/client'
import './index.css'
import AppDriver from '@/App.driver'
import DriverAppProviders from '@/shared/bootstrap/DriverAppProviders'
import AppErrorBoundary from '@/shared/components/AppErrorBoundary'
import { initMonitoring } from '@/shared/bootstrap/initMonitoring'

initMonitoring()

createRoot(document.getElementById('root')).render(
    <AppErrorBoundary>
        <DriverAppProviders>
            <AppDriver />
        </DriverAppProviders>
    </AppErrorBoundary>
)
