import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: false,
  nativeSignIn: vi.fn(),
  popupSignIn: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
  },
  registerPlugin: () => ({
    signIn: mocks.nativeSignIn,
  }),
}))

vi.mock('firebase/auth', () => ({
  signInWithPopup: mocks.popupSignIn,
}))

import { getGoogleIdToken } from '@/shared/services/googleAuth'

describe('getGoogleIdToken', () => {
  beforeEach(() => {
    mocks.native = false
    mocks.nativeSignIn.mockReset()
    mocks.popupSignIn.mockReset()
  })

  it('usa Credential Manager nativo no Android Capacitor', async () => {
    mocks.native = true
    mocks.nativeSignIn.mockResolvedValue({ idToken: 'firebase-native-token' })

    await expect(getGoogleIdToken({}, {})).resolves.toBe('firebase-native-token')
    expect(mocks.nativeSignIn).toHaveBeenCalledOnce()
    expect(mocks.popupSignIn).not.toHaveBeenCalled()
  })

  it('mantém o popup Firebase no site', async () => {
    const getIdToken = vi.fn().mockResolvedValue('firebase-web-token')
    const auth = { name: 'web-auth' }
    const provider = { name: 'google-provider' }
    mocks.popupSignIn.mockResolvedValue({ user: { getIdToken } })

    await expect(getGoogleIdToken(auth, provider)).resolves.toBe('firebase-web-token')
    expect(mocks.popupSignIn).toHaveBeenCalledWith(auth, provider)
    expect(getIdToken).toHaveBeenCalledOnce()
  })
})
