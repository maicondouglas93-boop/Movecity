import 'remixicon/fonts/remixicon.css'
import DriverAppRoutes from '@/shared/routes/DriverAppRoutes'
import NotificationNavigateListener from '@/shared/components/NotificationNavigateListener'
import DriverBackButton from '@/shared/components/DriverBackButton'
import ErrorBoundary from '@/shared/components/ErrorBoundary'
import AppUpdateGate from '@/shared/components/AppUpdateGate'

// Shell do build motorista: sem PWA (Install/Update). Rotas só de captain.
// AppUpdateGate = atualização do APK via backend (fora da Play Store).
const AppDriver = () => (
    <ErrorBoundary>
        <div>
            <NotificationNavigateListener />
            <DriverBackButton />
            <AppUpdateGate />
            <DriverAppRoutes />
        </div>
    </ErrorBoundary>
)

export default AppDriver
