import api from '@/shared/services/axios'
import { API_BASE_URL } from '@/shared/services/apiBase'
import { postImageUpload } from '@/shared/services/imageUpload'
import { withHardTimeout } from '@/shared/utils/hardTimeout'

export const SIGNUP_TIMEOUT_MS = 30000
export const SIGNUP_PHOTO_TIMEOUT_MS = 15000

export async function registerCaptain(credentials, { signal } = {}) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try {
        const response = await withHardTimeout(api.post('/captains/register', credentials, {
            signal: controller.signal,
            timeout: SIGNUP_TIMEOUT_MS,
            _skipSessionRecovery: true,
        }), SIGNUP_TIMEOUT_MS)
        if (response.status !== 201 || !response.data?.token || !response.data?.captain?._id) {
            const error = new Error('O servidor não confirmou todos os dados da conta.')
            error.registrationUncertain = true
            throw error
        }
        return response.data
    } catch (error) {
        const status = error.response?.status
        if (!status || status === 408 || status >= 500) error.registrationUncertain = true
        throw error
    } finally {
        signal?.removeEventListener('abort', abort)
        controller.abort()
    }
}

export async function uploadCaptainSignupPhoto(file, token, captainId, { signal } = {}) {
    const response = await withHardTimeout(postImageUpload(`${API_BASE_URL}/uploads/captain-profile`, file, {
        token,
        timeout: SIGNUP_PHOTO_TIMEOUT_MS,
        signal,
        skipSessionRecovery: true,
    }), SIGNUP_PHOTO_TIMEOUT_MS)
    const captain = response.data?.captain
    if (captain?._id !== captainId || !captain.profilePicture) {
        throw new Error('O envio da foto não foi confirmado.')
    }
    return captain.profilePicture
}
