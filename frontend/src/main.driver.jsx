import { createRoot } from 'react-dom/client'
import './index.css'
import AppDriver from '@/App.driver'
import DriverAppProviders from '@/shared/bootstrap/DriverAppProviders'
import AppErrorBoundary from '@/shared/components/AppErrorBoundary'
import { initMonitoring } from '@/shared/bootstrap/initMonitoring'
import { initializeNativeCaptainSession } from '@/shared/platform/nativeSession.service'

initMonitoring()

initializeNativeCaptainSession().catch(() => {}).then(() => createRoot(document.getElementById('root')).render(
    <AppErrorBoundary>
        <DriverAppProviders>
            <AppDriver />
        </DriverAppProviders>
    </AppErrorBoundary>
))
