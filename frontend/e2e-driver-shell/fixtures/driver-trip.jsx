// Fixture isolada: componentes reais, sem viagem, GPS, envio ou mapa de produção.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import DriverTripView from '@/driver/components/DriverTripView'
import ActiveRideHelp from '@/driver/components/ActiveRideHelp'
import DriverOperationalDialog from '@/driver/components/DriverOperationalDialog'
import { activeRidePresentation } from '@/driver/services/activeRidePresentation'
import { SocketContext } from '@/shared/contexts/SocketContext'
import '@/index.css'
import 'remixicon/fonts/remixicon.css'

const mode = new URLSearchParams(window.location.search).get('mode') || 'server'
const socket = { connected: mode !== 'local', on() {}, off() {} }
const ride = { _id: 'fixture-trip', status: 'started', source: mode === 'local' ? 'driver_initiated' : 'app',
    destinationPending: mode === 'local', fare: 18.25, pickup: 'Avenida do embarque, 123, bairro Centro',
    destination: 'Avenida do destino, 456, bairro São Sebastião', paymentMethod: 'cash',
    user: { _id: 'fixture-passenger', fullname: { firstname: 'Passageiro de teste' }, phone: '+55 (33) 99999-9999' },
}
function Trip() {
    const [expanded, setExpanded] = useState(false)
    const [panel, setPanel] = useState(null)
    const [navigation, setNavigation] = useState(true)
    const presentation = activeRidePresentation({ ride, meter: { rideId: ride._id, amount: 28.31, distance: 8100,
        local: mode !== 'server', calculationError: mode === 'read-error' }, internet: true, connected: socket.connected,
        location: { lat: -20.15, lng: -41.62, timestamp: Date.now(), accuracy: mode === 'gps' ? 150 : 10 } })
    return <>
        <DriverTripView ride={ride} presentation={presentation} elapsedSec={725}
            expanded={expanded} onExpand={() => setExpanded(value => !value)} onFinish={() => setPanel('finish')}
            onHelp={() => setPanel('help')} onCancel={() => {}} canCancel={false} onChat={() => {}} unreadCount={2}
            onReviewGps={() => {}} onRetryMeter={() => {}} navigationMode={navigation} onNavigationToggle={() => setNavigation(value => !value)}
            navInfo={{ step: { maneuver: 'turn-right', instruction: 'Vire à direita na Avenida do destino, bairro São Sebastião' }, distanceToStepM: 250, etaMinutes: 7 }}
            mapsUrl={ride.destinationPending ? null : 'https://www.google.com/maps/dir/?api=1&destination=-20.15,-41.62'} modalOpen={Boolean(panel)}>
            <div className="h-full w-full bg-brand-100 flex items-center justify-center text-sm">Área livre do mapa (simulada)</div>
        </DriverTripView>
        <DriverOperationalDialog open={panel === 'help'} title="Ajuda e segurança" closeLabel="Voltar à corrida" onClose={() => setPanel(null)}>
            <ActiveRideHelp ride={ride} presentation={presentation} onClose={() => setPanel(null)} />
        </DriverOperationalDialog>
        <DriverOperationalDialog open={panel === 'finish'} title="Finalização de teste" onClose={() => setPanel(null)}>
            <p>A finalização real não é executada nesta fixture visual.</p>
        </DriverOperationalDialog>
    </>
}
createRoot(document.getElementById('root')).render(<SocketContext.Provider value={{ socket }}><MemoryRouter><Trip /></MemoryRouter></SocketContext.Provider>)
