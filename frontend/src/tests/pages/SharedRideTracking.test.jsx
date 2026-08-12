import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import SharedRideTracking from '@/passenger/pages/SharedRideTracking'

describe('Acompanhamento compartilhado da corrida', () => {
    it('mostra somente a visão pública sanitizada', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                rideId: 'ride1',
                status: 'started',
                pickup: 'Praça Central',
                destination: 'Hospital Municipal',
                captain: {
                    fullname: { firstname: 'Maria', lastname: 'Silva' },
                    vehicle: { plate: 'ABC1D23', modelo: 'Onix' },
                },
                location: { lat: -20.1, lng: -41.6 },
            }),
        })

        render(
            <MemoryRouter initialEntries={['/track/token-publico']}>
                <Routes>
                    <Route path="/track/:token" element={<SharedRideTracking />} />
                </Routes>
            </MemoryRouter>
        )

        await waitFor(() => expect(screen.getByText('Corrida em andamento')).toBeInTheDocument())
        expect(screen.getByText('Maria Silva')).toBeInTheDocument()
        expect(screen.getByText('ABC1D23')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /ver localização atual/i })).toHaveAttribute(
            'href',
            'https://maps.google.com/?q=-20.1,-41.6'
        )
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/rides/share/token-publico'))
        fetchMock.mockRestore()
    })
})
