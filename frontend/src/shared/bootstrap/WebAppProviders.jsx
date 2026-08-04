import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import UserContext from '@/passenger/contexts/UserContext'
import CaptainContext from '@/driver/contexts/CaptainContext'
import SocketProvider from '@/shared/contexts/SocketContext'
import { LocationProvider } from '@/shared/contexts/LocationContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'
import RideProvider from '@/shared/contexts/RideContext'
import { queryClient } from '@/shared/services/queryClient'

// Extração mecânica da árvore de main.jsx (web). Ordem idêntica — não “melhorar”.
const WebAppProviders = ({ children }) => (
    <QueryClientProvider client={queryClient}>
        <CaptainContext>
            <UserContext>
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
            </UserContext>
        </CaptainContext>
    </QueryClientProvider>
)

export default WebAppProviders
