import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserDataContext } from '@/passenger/contexts/UserContext'
import PassengerPushBridge from '@/passenger/components/PassengerPushBridge'

const mocks = vi.hoisted(() => ({
    requestLocationPermission: vi.fn(),
    registerPush: vi.fn(),
    bindPushNavigation: vi.fn(),
}))

vi.mock('@/shared/platform/platform', () => ({
    isNativePlatform: () => true,
}))

vi.mock('@/shared/platform/location.service', () => ({
    requestLocationPermission: mocks.requestLocationPermission,
}))

vi.mock('@/shared/platform/notification.service', () => ({
    registerPush: mocks.registerPush,
    bindPushNavigation: mocks.bindPushNavigation,
}))

vi.mock('@/shared/contexts/ToastContext', () => ({
    useToast: () => ({ addToast: vi.fn() }),
}))

describe('PassengerPushBridge', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.requestLocationPermission.mockResolvedValue({ granted: true, state: 'granted' })
        mocks.registerPush.mockResolvedValue('token')
        mocks.bindPushNavigation.mockResolvedValue(vi.fn())
    })

    it('solicita o GPS antes da permissão de notificações', async () => {
        render(
            <MemoryRouter>
                <UserDataContext.Provider value={{ user: { _id: 'user-1' } }}>
                    <PassengerPushBridge />
                </UserDataContext.Provider>
            </MemoryRouter>
        )

        await waitFor(() => expect(mocks.bindPushNavigation).toHaveBeenCalledTimes(1))

        expect(mocks.requestLocationPermission).toHaveBeenCalledTimes(1)
        expect(mocks.registerPush).toHaveBeenCalledTimes(1)
        expect(mocks.requestLocationPermission.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.registerPush.mock.invocationCallOrder[0])
    })
})
