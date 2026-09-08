// Apenas componentes reais com dados sintéticos; nenhum motorista/serviço real.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DriverAccountShell from '@/driver/components/DriverAccountShell'
import DriverOperationalDialog from '@/driver/components/DriverOperationalDialog'
import CaptainDetails from '@/driver/components/CaptainDetails'
import DriverGoButton from '@/driver/components/DriverGoButton'
import ConfirmRidePopUp from '@/driver/components/ConfirmRidePopUp'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { LocationRefContext } from '@/shared/contexts/LocationContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'
import '@/index.css'
import 'remixicon/fonts/remixicon.css'

const mode = new URLSearchParams(window.location.search).get('mode') || 'offline'
const socket = { connected: mode !== 'reconnecting', on() {}, off() {} }
const locationRef = { current: { lat: -20.15, lng: -41.62, timestamp: Date.now() } }
const initialRide = { _id: 'fixture-ride', status: 'accepted', captain: 'fixture-driver',
    pickup: 'Avenida de teste do passageiro, 123, Centro', destination: 'Rua do destino, 456',
    pickupCoordinates: { lat: -20.15, lng: -41.62 }, fare: 18.25,
    estimatedDistance: 8100, paymentMethod: 'cash',
    user: { fullname: { firstname: 'Passageiro de teste' }, phone: '+55 (33) 99999-9999' },
}
function Home() {
    const [captain, setCaptain] = useState({ _id: 'fixture-driver', approvalStatus: 'aprovado', isOnline: mode !== 'offline' })
    const [ride, setRide] = useState(mode === 'pickup' ? initialRide : null)
    const [open, setOpen] = useState(mode === 'pickup')
    const [busy, setBusy] = useState(false)
    return <CaptainDataContext.Provider value={{ captain, setCaptain }}><RideContext.Provider value={{ captainRide: ride, setCaptainRide: setRide }}>
        <DriverAccountShell modalOpen={open}>
            <div className="flex-1 min-h-[22%] bg-brand-100 p-4">Área do mapa (simulada)</div>
            <div className="shrink-0 max-h-[70%] min-h-0 p-3 overflow-y-auto pb-6 bg-surface-alt">
                <CaptainDetails onAvailabilityBusyChange={setBusy}>
                    {!ride && <DriverGoButton disabled={busy} />}
                </CaptainDetails>
            </div>
        </DriverAccountShell>
        {open && <DriverOperationalDialog title="Embarque da corrida" onClose={() => setOpen(false)}>
            <ConfirmRidePopUp ride={ride} setRide={setRide} setConfirmRidePopupPanel={setOpen} setRidePopupPanel={() => {}} />
        </DriverOperationalDialog>}
    </RideContext.Provider></CaptainDataContext.Provider>
}
createRoot(document.getElementById('root')).render(<ToastProvider>
    <SocketContext.Provider value={{ socket }}><LocationRefContext.Provider value={{ locationRef, locationError: mode === 'gps' ? 'Permissão de localização negada.' : null }}>
        <MemoryRouter initialEntries={['/captain-home']}><Routes>
            <Route path="/captain-home" element={<Home />} />
            <Route path="/captain-riding" element={<p>Início confirmado no teste</p>} />
            <Route path="/captain-presential" element={<p>Preparação da corrida presencial</p>} />
        </Routes></MemoryRouter>
    </LocationRefContext.Provider></SocketContext.Provider>
</ToastProvider>)
