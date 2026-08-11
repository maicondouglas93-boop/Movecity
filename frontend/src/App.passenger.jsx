import 'remixicon/fonts/remixicon.css'
import PassengerAppRoutes from '@/shared/routes/PassengerAppRoutes'
import NotificationNavigateListener from '@/shared/components/NotificationNavigateListener'
import ErrorBoundary from '@/shared/components/ErrorBoundary'
import ConfigErrorScreen from '@/shared/components/ConfigErrorScreen'
import { isApiBaseConfigured } from '@/shared/services/apiBase'

// Shell do APK do Passageiro: sem instalação/atualização PWA e sem rotas do Motorista.
const AppPassenger = () => {
    if (!isApiBaseConfigured()) return <ConfigErrorScreen />

    return (
        <ErrorBoundary>
            <div>
                <NotificationNavigateListener />
                <PassengerAppRoutes />
            </div>
        </ErrorBoundary>
    )
}

export default AppPassenger
