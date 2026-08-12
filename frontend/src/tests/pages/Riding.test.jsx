import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import Riding from '@/passenger/pages/Riding'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { UserDataContext } from '@/passenger/contexts/UserContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'

vi.mock('@/shared/components/LiveTracking', () => ({
    default: () => <div>Mapa da corrida</div>,
}))

vi.mock('@/shared/components/RideChat', () => ({
    default: () => null,
}))

vi.mock('@/shared/services/axios', () => ({
    default: {
        get: vi.fn().mockResolvedValue({ data: { chat: { unreadUser: 0 } } }),
        post: vi.fn(),
    },
}))

const ride = {
    _id: '64f000000000000000000001',
    status: 'started',
    fare: 20,
    vehicleType: 'car',
    paymentMethod: 'pix',
    pickup: 'Praça Central, 1',
    destination: 'Hospital, 10',
    captain: {
        fullname: { firstname: 'João', lastname: 'Silva' },
        vehicle: { plate: 'ABC1D23', color: 'Prata', vehicleType: 'car' },
    },
}

describe('Riding — minimizar corrida ativa', () => {
    it('volta à Home sem apagar a corrida do contexto', () => {
        const clearUserRide = vi.fn()
        const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false }
        const rideContext = {
            userRide: ride,
            setUserRide: vi.fn(),
            syncUserRide: vi.fn().mockResolvedValue(ride),
            clearUserRide,
        }

        render(
            <MemoryRouter initialEntries={[{ pathname: '/riding', state: { ride } }]}>
                <UserDataContext.Provider value={{ user: { _id: 'user1' } }}>
                    <SocketContext.Provider value={{ socket }}>
                        <RideContext.Provider value={rideContext}>
                            <ToastProvider>
                                <Routes>
                                    <Route path="/riding" element={<Riding />} />
                                    <Route path="/home" element={<div>HOME PRESERVADA</div>} />
                                </Routes>
                            </ToastProvider>
                        </RideContext.Provider>
                    </SocketContext.Provider>
                </UserDataContext.Provider>
            </MemoryRouter>
        )

        fireEvent.click(screen.getByRole('button', { name: 'Minimizar corrida' }))

        expect(screen.getByText('HOME PRESERVADA')).toBeInTheDocument()
        expect(clearUserRide).not.toHaveBeenCalled()
    })
})
