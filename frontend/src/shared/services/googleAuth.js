import { Capacitor, registerPlugin } from '@capacitor/core'
import { signInWithPopup } from 'firebase/auth'

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

  const result = await signInWithPopup(auth, provider)
  return result.user.getIdToken()
}
