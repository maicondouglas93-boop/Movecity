import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import UserContext from '@/passenger/contexts/UserContext'
import SocketProvider from '@/shared/contexts/SocketContext'
import { LocationProvider } from '@/shared/contexts/LocationContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'
import { NotificationInboxProvider } from '@/shared/contexts/NotificationInboxContext'
import RideProvider from '@/shared/contexts/RideContext'
import { queryClient } from '@/shared/services/queryClient'
import PassengerNativeDeepLinkBridge from '@/passenger/components/PassengerNativeDeepLinkBridge'
import PassengerPushBridge from '@/passenger/components/PassengerPushBridge'

// Mantém a mesma infraestrutura compartilhada do Web, sem carregar contexto,
// rotas ou bridges exclusivos do Motorista no APK do Passageiro.
// eslint-disable-next-line react/prop-types
const PassengerAppProviders = ({ children }) => (
    <QueryClientProvider client={queryClient}>
        <UserContext>
            <ToastProvider>
                <SocketProvider>
                    <NotificationInboxProvider>
                        <LocationProvider>
                            <BrowserRouter>
                                <RideProvider>
                                    <PassengerNativeDeepLinkBridge />
                                    <PassengerPushBridge />
                                    {children}
                                </RideProvider>
                            </BrowserRouter>
                        </LocationProvider>
                    </NotificationInboxProvider>
                </SocketProvider>
            </ToastProvider>
        </UserContext>
    </QueryClientProvider>
)

export default PassengerAppProviders
