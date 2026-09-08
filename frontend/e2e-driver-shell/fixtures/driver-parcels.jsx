// Synthetic account and server; browser test replaces only the map module.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'
import CaptainParcelRiding from '@/driver/pages/CaptainParcelRiding'
import CaptainScheduled from '@/driver/pages/CaptainScheduled'
import api from '@/shared/services/axios'
import { saveSession } from '@/shared/services/session'
import '@/index.css'
import 'remixicon/fonts/remixicon.css'

const mode = new URLSearchParams(window.location.search).get('mode') || 'parcel'
const owner = 'synthetic-driver'
const socket = { on() {}, off() {}, emit() {} }
saveSession('captain', { token: `header.${btoa(JSON.stringify({ _id: owner, actorType: 'captain' }))}.sig` }, { syncNative: false })
const parcel = { _id: 'synthetic-parcel', status: 'arrived_destination', paymentStatus: 'pending', paymentMethod: 'pix',
    pickup: 'Avenida da retirada, 123, bairro São Sebastião', destination: 'Rua do destinatário, 456, Centro',
    fare: 25, driverAmount: 22, itemName: 'Pacote de teste', requireDeliveryPin: true }
window.fixtureParcelFailure = true
window.fixtureParcelWrites = 0
api.defaults.adapter = async config => {
    let data
    if (config.url === '/captains/scheduled-upcoming') {
        if (window.fixtureParcelFailure) throw new Error('Synthetic network failure')
        data = { upcoming: [{ ...parcel, kind: 'parcel', vehicleType: 'moto', scheduledAt: '2026-09-09T14:00:00Z' }] }
    } else if (config.url.endsWith('/confirm-delivery')) {
        window.fixtureParcelWrites++
        if (window.fixtureParcelFailure) throw new Error('Synthetic response loss')
        parcel.status = 'finished'; parcel.paymentStatus = 'paid'; data = { ...parcel }
    } else if (config.url.endsWith('/skip-captain-review')) {
        data = { ok: true, parcelId: parcel._id }
    } else throw new Error('Unexpected fixture request')
    return { config, status: 200, statusText: 'OK', headers: {}, data }
}
function Fixture() {
    const [current, setCurrent] = useState(parcel)
    return <CaptainDataContext.Provider value={{ captain: { _id: owner } }}>
        <SocketContext.Provider value={{ socket }}>
            <RideContext.Provider value={{ captainParcel: current, captainParcelOwnerId: owner, setCaptainParcel: setCurrent,
                syncCaptainParcel: async () => ({ ...parcel }) }}><ToastProvider><Routes>
                    <Route path="/captain-parcel" element={<CaptainParcelRiding />} />
                    <Route path="/captain-scheduled" element={<div className="h-[100dvh]"><CaptainScheduled /></div>} />
                    <Route path="/captain-home" element={<p>Início de teste</p>} />
                </Routes></ToastProvider></RideContext.Provider>
        </SocketContext.Provider>
    </CaptainDataContext.Provider>
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[mode === 'parcel' ? '/captain-parcel' : '/captain-scheduled']}><Fixture /></MemoryRouter>
</QueryClientProvider>)
