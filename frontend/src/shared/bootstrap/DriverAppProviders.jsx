import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import CaptainContext from '@/driver/contexts/CaptainContext'
import SocketProvider from '@/shared/contexts/SocketContext'
import { LocationProvider } from '@/shared/contexts/LocationContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'
import RideProvider from '@/shared/contexts/RideContext'
import { queryClient } from '@/shared/services/queryClient'

// Mesma árvore do web, sem UserContext (não importar passenger aqui — grafo do driver).
const DriverAppProviders = ({ children }) => (
    <QueryClientProvider client={queryClient}>
        <CaptainContext>
            <ToastProvider>
                <SocketProvider>
                    <LocationProvider>
                        {/* RideProvider precisa do BrowserRouter (usa useNavigate/useLocation
                  pra restaurar a tela certa de uma corrida ativa) e do SocketProvider
                  (re-sincroniza a corrida no 'connect'). */}
                        <BrowserRouter>
                            <RideProvider>
                                {children}
                            </RideProvider>
                        </BrowserRouter>
                    </LocationProvider>
                </SocketProvider>
            </ToastProvider>
        </CaptainContext>
    </QueryClientProvider>
)

export default DriverAppProviders
