// Fixture exclusiva do servidor de testes. Não faz parte dos bundles publicados.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DriverAccountShell from '@/driver/components/DriverAccountShell'
import DriverOperationalDialog from '@/driver/components/DriverOperationalDialog'
import RidePopUp from '@/driver/components/RidePopUp'
import PageHeader from '@/shared/components/ui/PageHeader'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'
import '@/index.css'
import 'remixicon/fonts/remixicon.css'

const socket = { connected: true, on() {}, off() {} }
const ride = {
    _id: 'fixture-only', pickup: 'Avenida de teste com endereço comprido, 120',
    destination: 'Rua de teste do destino, 80', vehicleType: 'moto',
    user: { fullname: { firstname: 'Passageiro teste' } }, fare: 18.25,
    paymentMethod: 'cash', estimatedTime: 720, estimatedDistance: 3100,
    pickupCoordinates: { lat: -20.151, lng: -41.622 },
    offerExpiresAt: new Date(Date.now() + 600_000).toISOString(),
}
function Account() {
    return <div className="h-full flex flex-col min-h-0"><PageHeader title="Ganhos" /><div className="overflow-y-auto p-4">
        <p className="text-ink-900">Página secundária preservada</p>
        <label className="block mt-4">Anotação de teste<input className="block w-full border border-line p-3" /></label>
    </div></div>
}
function Shell() {
    const [open, setOpen] = useState(false)
    return <><DriverAccountShell modalOpen={open} notice={<button className="min-h-[44px]" onClick={() => setOpen(true)}>Receber oferta de teste</button>}>
        <div>Mapa mantido</div>
    </DriverAccountShell>
    {open && <DriverOperationalDialog title="Oferta de corrida" onClose={() => setOpen(false)}>
        <RidePopUp ride={ride} open confirmRide={() => {}} onDecline={() => setOpen(false)} />
    </DriverOperationalDialog>}</>
}
createRoot(document.getElementById('root')).render(
    <ToastProvider><SocketContext.Provider value={{ socket }}><LocationContext.Provider value={{ userLocation: { lat: -20.15, lng: -41.62 } }}>
        <MemoryRouter initialEntries={['/captain/earnings']}><Routes><Route element={<Shell />}>
            <Route path="/captain/earnings" element={<Account />} />
        </Route></Routes></MemoryRouter>
    </LocationContext.Provider></SocketContext.Provider></ToastProvider>,
)
