import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import NotificationNavigateListener from '@/shared/components/NotificationNavigateListener'

const LocationProbe = () => {
    const location = useLocation()
    return <div data-testid="path">{location.pathname}{location.search}</div>
}

describe('NotificationNavigateListener', () => {
    it('navega para o deep link enviado pelo Service Worker', async () => {
        const listeners = new Map()
        const addEventListener = vi.fn((type, fn) => listeners.set(type, fn))
        const removeEventListener = vi.fn()

        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: { addEventListener, removeEventListener },
        })

        render(
            <MemoryRouter initialEntries={['/captain-home']}>
                <NotificationNavigateListener />
                <Routes>
                    <Route path="*" element={<LocationProbe />} />
                </Routes>
            </MemoryRouter>
        )

        const handler = listeners.get('message')
        expect(handler).toBeTypeOf('function')

        handler({
            data: {
                type: 'NOTIFICATION_NAVIGATE',
                // Mesma origem do jsdom — o listener rejeita deep link cross-origin.
                url: `${window.location.origin}/captain-home?rideOffer=ride-99`,
            },
        })

        await waitFor(() => {
            expect(document.querySelector('[data-testid="path"]')?.textContent)
                .toBe('/captain-home?rideOffer=ride-99')
        })
    })
})
