import { Capacitor, registerPlugin } from '@capacitor/core'
import { signInWithPopup, signInWithRedirect, getRedirectResult } from 'firebase/auth'

const PassengerGoogleAuth = registerPlugin('PassengerGoogleAuth')

/**
 * Retorna sempre um Firebase Auth ID token aceito pelo backend MoveCity.
 *
 * O popup da SDK web depende de uma sessão no navegador e não é confiável dentro
 * do WebView do Capacitor. No Android usamos o Credential Manager nativo; no site
 * preservamos o popup já usado pelos navegadores comuns.
 */
export const getGoogleIdToken = async (auth, provider) => {
  if (Capacitor.isNativePlatform()) {
    const result = await PassengerGoogleAuth.signIn()
    if (!result?.idToken) throw new Error('O Google não retornou um token de acesso')
    return result.idToken
  }

  if (!auth) {
    const error = new Error('Login com Google indisponível neste ambiente')
    error.code = 'GOOGLE_AUTH_NOT_CONFIGURED'
    throw error
  }

  try {
    const result = await signInWithPopup(auth, provider)
    return result.user.getIdToken()
  } catch (error) {
    if (error.code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, provider)
      const redirectError = new Error('Redirecionando para o Google...')
      redirectError.code = 'auth/redirect-started'
      throw redirectError
    }
    throw error
  }
}

/**
 * Verifica se o usuário acabou de voltar de um redirecionamento do Google (necessário para o fallback do iOS Safari).
 */
export const checkGoogleRedirectResult = async (auth) => {
  if (!auth || Capacitor.isNativePlatform()) return null
  
  try {
    const result = await getRedirectResult(auth)
    if (result && result.user) {
      return result.user.getIdToken()
    }
  } catch (error) {
    console.error('Erro ao recuperar login via redirect:', error)
    throw error
  }
  
  return null
}
