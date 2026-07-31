import 'remixicon/fonts/remixicon.css'
import { ToastProvider } from '@/contexts/ToastContext'
import AppRoutes from '@/routes/AppRoutes'

const App = () => {

  return (
    <ToastProvider>
      <div>
        <AppRoutes />
      </div>
    </ToastProvider>
  )
}

export default App
