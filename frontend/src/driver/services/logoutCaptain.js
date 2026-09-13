import api from '@/shared/services/axios'
import { getAccessToken, getRefreshToken, clearSession } from '@/shared/services/session'
import { clearTokenInSW } from '@/shared/services/swCommunication'
import { queryClient } from '@/shared/services/queryClient'
import { unregisterPush } from '@/shared/platform/notification.service'
import { stopForegroundTracking } from '@/shared/platform/location.service'
import { withHardTimeout } from '@/shared/utils/hardTimeout'

export const LOGOUT_TIMEOUT_MS = 5000

export function logoutCaptain() {
    const token = getAccessToken('captain')
    const refreshToken = getRefreshToken('captain')
    const controller = new AbortController()
    const config = {
        headers: { Authorization: token ? `Bearer ${token}` : false },
        _sessionKind: 'captain',
        _skipSessionRecovery: true,
        signal: controller.signal,
        timeout: LOGOUT_TIMEOUT_MS,
    }

    // Captura as credenciais antes de limpar. As operações remotas podem falhar,
    // mas a sessão local é encerrada sem depender de rede ou de uma ponte nativa.
    const cleanup = Promise.allSettled([
        unregisterPush(config),
        stopForegroundTracking(),
        api.post('/captains/logout', refreshToken ? { refreshToken } : {}, config),
        clearTokenInSW({ shouldClear: () => !getAccessToken('captain') }),
    ])
    clearSession('captain')
    queryClient.removeQueries({ queryKey: ['captainWallet'] })
    queryClient.removeQueries({ queryKey: ['captainTransactions'] })

    return withHardTimeout(cleanup, LOGOUT_TIMEOUT_MS)
        .catch(() => {})
        .finally(() => controller.abort())
}
