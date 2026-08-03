import 'remixicon/fonts/remixicon.css'
import AppRoutes from '@/routes/AppRoutes'
import UpdatePrompt from '@/shared/components/ui/UpdatePrompt'
import InstallPrompt from '@/shared/components/ui/InstallPrompt'

// ToastProvider subiu pro main.jsx (fora do SocketProvider) — a fila offline (P1.2 da
// auditoria de concorrência) precisa avisar o motorista quando uma ação sincroniza ou
// falha de vez, e isso só é possível se o SocketContext conseguir usar useToast().
const App = () => {

  return (
    <div>
      <AppRoutes />
      <UpdatePrompt />
      <InstallPrompt />
    </div>
  )
}

export default App
