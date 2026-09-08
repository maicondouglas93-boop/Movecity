// Componentes reais, transporte isolado e dados sintéticos; nenhum saldo real.
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'
import CaptainEarnings from '@/driver/pages/CaptainEarnings'
import AppUpdateGate, { requestAppUpdateCheck } from '@/shared/components/AppUpdateGate'
import api from '@/shared/services/axios'
import { saveSession } from '@/shared/services/session'
import '@/index.css'
import 'remixicon/fonts/remixicon.css'

const mode = new URLSearchParams(window.location.search).get('mode') || 'valid'
window.fixtureEarningsFail = mode === 'error'
saveSession('captain', { token: 'synthetic-fixture-token' }, { syncNative: false })
api.defaults.adapter = async config => {
    if (!config.url.startsWith('/captains/earnings?') || window.fixtureEarningsFail) throw new Error('Consulta indisponível na fixture')
    const range = new URL(config.url, window.location.origin).searchParams.get('range')
    const amount = range === 'day' ? 63.90 : range === 'week' ? 210 : 850
    return { config, status: 200, statusText: 'OK', headers: {}, data: {
        range, totalEarnings: amount, totalRides: 1,
        rides: [{ rideId: 'synthetic-ride', date: '2026-09-08', netEarnings: amount,
            pickup: 'Avenida do embarque, 123, bairro São Sebastião', destination: 'Rua do destino completo, 456, Centro' }],
    } }
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><MemoryRouter>
    <CaptainDataContext.Provider value={{ captain: { _id: 'synthetic-driver', isOnline: false } }}>
        <RideContext.Provider value={{ captainRideReconciled: true }}><ToastProvider>
            <div className="h-[100dvh] flex flex-col">
                <button className="shrink-0 min-h-[44px] border-b border-line" onClick={requestAppUpdateCheck}>Atualizar app (teste)</button>
                <div className="flex-1 min-h-0"><CaptainEarnings /></div>
            </div>
            <AppUpdateGate />
        </ToastProvider></RideContext.Provider>
    </CaptainDataContext.Provider>
</MemoryRouter></QueryClientProvider>)
