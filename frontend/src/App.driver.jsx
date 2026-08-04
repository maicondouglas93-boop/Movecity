import 'remixicon/fonts/remixicon.css'
import DriverAppRoutes from '@/shared/routes/DriverAppRoutes'
import NotificationNavigateListener from '@/shared/components/NotificationNavigateListener'

// Shell do build motorista: sem PWA (Install/Update). Rotas só de captain.
const AppDriver = () => (
    <div>
        <NotificationNavigateListener />
        <DriverAppRoutes />
    </div>
)

export default AppDriver
