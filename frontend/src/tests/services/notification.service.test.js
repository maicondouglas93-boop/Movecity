import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
    const handlers = {}
    return {
        handlers,
        post: vi.fn(),
        delete: vi.fn(),
        checkPermissions: vi.fn(),
        requestPermissions: vi.fn(),
        register: vi.fn(),
        removeAllListeners: vi.fn(),
        addListener: vi.fn(async (event, handler) => {
            handlers[event] = handler
            return {
                remove: vi.fn(() => {
                    if (handlers[event] === handler) delete handlers[event]
                }),
            }
        }),
    }
})

vi.mock('@/shared/platform/platform', () => ({
    isNativePlatform: () => true,
    getPlatformLabel: () => 'android',
}))

vi.mock('@/shared/services/axios', () => ({
    default: {
        post: mocks.post,
        delete: mocks.delete,
    },
}))

vi.mock('@/shared/services/fcm', () => ({
    requestFCMToken: vi.fn(),
    getCurrentFcmToken: vi.fn(),
    onForegroundMessage: vi.fn(() => vi.fn()),
}))

vi.mock('@/shared/platform/nativePush.plugin', () => ({
    getNativePushNotifications: vi.fn(async () => ({
        checkPermissions: mocks.checkPermissions,
        requestPermissions: mocks.requestPermissions,
        register: mocks.register,
        addListener: mocks.addListener,
        removeAllListeners: mocks.removeAllListeners,
    })),
}))

describe('notification.service — push nativo', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
        Object.keys(mocks.handlers).forEach((key) => delete mocks.handlers[key])
        mocks.checkPermissions.mockResolvedValue({ receive: 'granted' })
        mocks.requestPermissions.mockResolvedValue({ receive: 'granted' })
        mocks.post.mockResolvedValue({})
        mocks.register.mockImplementation(async () => {
            await Promise.resolve()
            await mocks.handlers.registration?.({ value: 'token-android-1' })
        })
    })

    it('não remove o listener de registro quando liga a navegação por push', async () => {
        const { bindPushNavigation, getPushPermissionStatus, registerPush } = await import(
            '@/shared/platform/notification.service'
        )

        // Pré-carrega o plugin mockado antes de iniciar as duas operações em paralelo.
        await getPushPermissionStatus()
        const registration = registerPush()
        const cleanup = await bindPushNavigation(vi.fn())
        const token = await registration

        expect(token).toBe('token-android-1')
        expect(mocks.removeAllListeners).not.toHaveBeenCalled()
        expect(mocks.post).toHaveBeenCalledWith('/notifications/token', {
            token: 'token-android-1',
            device: 'android',
        })

        cleanup()
        expect(mocks.handlers.registration).toBeTypeOf('function')
        expect(mocks.handlers.pushNotificationReceived).toBeUndefined()
        expect(mocks.handlers.pushNotificationActionPerformed).toBeUndefined()
    })

    it('não abre o diálogo do Android durante uma verificação silenciosa', async () => {
        mocks.checkPermissions.mockResolvedValue({ receive: 'prompt' })
        const { registerPush } = await import('@/shared/platform/notification.service')

        const token = await registerPush({ requestPermission: false })

        expect(token).toBeNull()
        expect(mocks.requestPermissions).not.toHaveBeenCalled()
        expect(mocks.register).not.toHaveBeenCalled()
    })

    it('distingue permissão bloqueada de falha no registro do token', async () => {
        mocks.checkPermissions.mockResolvedValue({ receive: 'denied' })
        const { getPushPermissionStatus } = await import(
            '@/shared/platform/notification.service'
        )

        await expect(getPushPermissionStatus()).resolves.toEqual({
            supported: true,
            granted: false,
            state: 'denied',
        })
    })
})
