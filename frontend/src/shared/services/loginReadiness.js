import api from '@/shared/services/axios'
import { withHardTimeout } from '@/shared/utils/hardTimeout'

export const LOGIN_WARMUP_TIMEOUT_MS = 30_000
export const LOGIN_REQUEST_TIMEOUT_MS = 30_000
const SLOW_SERVER_NOTICE_MS = 1_500

function offlineError() {
  const error = new Error('OFFLINE')
  error.isConnectivityIssue = true
  error.friendlyMessage = 'Sem internet. Verifique sua conexão e tente novamente.'
  return error
}

/**
 * Acorda o backend antes de enviar credenciais. O plano gratuito pode levar mais que o
 * timeout global de 10s para responder ao primeiro request depois de ficar inativo.
 */
export async function loginCaptainReliably(
  credentials,
  {
    client = api,
    onStage = () => {},
    warmupTimeout = LOGIN_WARMUP_TIMEOUT_MS,
    loginTimeout = LOGIN_REQUEST_TIMEOUT_MS,
  } = {},
) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw offlineError()
  }

  onStage('Conectando ao servidor...')
  const slowNotice = setTimeout(() => onStage('Servidor iniciando, aguarde...'), SLOW_SERVER_NOTICE_MS)

  try {
    await withHardTimeout(
      client.get('/api/ready', { timeout: warmupTimeout }),
      warmupTimeout,
    )
  } catch {
    // O login é a verificação definitiva. Se o wake-up expirar, ele ainda pode ter
    // iniciado o servidor em segundo plano; seguimos sem duplicar o POST de sessão.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw offlineError()
    }
  } finally {
    clearTimeout(slowNotice)
  }

  onStage('Verificando acesso...')
  try {
    return await withHardTimeout(
      client.post('/captains/login', credentials, { timeout: loginTimeout }),
      loginTimeout,
    )
  } catch (error) {
    if (error?.isConnectivityIssue || !error?.response) {
      error.friendlyMessage = error.friendlyMessage
        || 'O servidor demorou para responder. Aguarde alguns segundos e tente novamente.'
    }
    throw error
  }
}
