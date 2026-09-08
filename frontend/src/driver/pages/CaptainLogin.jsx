import { useContext, useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import Button from '@/shared/components/ui/Button'

import { useToast } from '@/shared/contexts/ToastContext'
import { saveSession, getAccessToken } from '@/shared/services/session'
import { syncTokenWithSW } from '@/shared/services/swCommunication'
import { getAppRole } from '@/shared/platform/platform'
import { loginCaptainReliably } from '@/shared/services/loginReadiness'

const Captainlogin = () => {

  const [ email, setEmail ] = useState('')
  const [ password, setPassword ] = useState('')
  const [ loading, setLoading ] = useState(false)
  const [ loginStage, setLoginStage ] = useState('')
  const [ showPassword, setShowPassword ] = useState(false)
  const [ loginError, setLoginError ] = useState('')
  const busyRef = useRef(false)
  const mountedRef = useRef(false)
  const emailRef = useRef(null)
  const passwordRef = useRef(null)

  const { setCaptain } = useContext(CaptainDataContext)
  const navigate = useNavigate()
  const { addToast } = useToast()

  useEffect(() => {
    mountedRef.current = true
    if (getAccessToken('captain')) {
      navigate('/captain-home')
    }
    return () => { mountedRef.current = false }
  }, [navigate])

  const submitHandler = async (e) => {
    e.preventDefault();
    if (busyRef.current) return
    busyRef.current = true
    setLoginError('')
    setLoading(true)
    setLoginStage('Conectando ao servidor...')

    // Android WebView/autofill às vezes preenche o DOM sem atualizar o state do React.
    // Lê do form/DOM na hora do submit para não mandar email/senha vazios.
    const form = e.currentTarget
    const fd = new FormData(form)
    const emailValue = String(
      fd.get('email') || emailRef.current?.value || email || ''
    ).trim().toLowerCase()
    const passwordValue = String(
      fd.get('password') || passwordRef.current?.value || password || ''
    )

    const captainData = {
      email: emailValue,
      password: passwordValue
    }

    try {
      const response = await loginCaptainReliably(captainData, { onStage: stage => { if (mountedRef.current) setLoginStage(stage) } })
      if (!mountedRef.current) return
      if (response.status !== 200 || !response.data?.captain?._id || !response.data?.token) {
        throw new Error('Resposta de acesso incompleta')
      }

      if (response.status === 200) {
        const data = response.data

        saveSession('captain', data)
        setCaptain(data.captain)
        syncTokenWithSW(data.token)
        addToast(`Bem-vindo, ${data.captain.fullname?.firstname || 'motorista'}!`, 'success')
        navigate('/captain-home')
        setEmail('')
        setPassword('')
      }
    } catch (err) {
      if (!mountedRef.current) return
      const status = err.response?.status
      const backendMsg = err.response?.data?.message
      let msg = err.friendlyMessage
      if (!msg && status === 401) msg = backendMsg || 'Email ou senha inválidos'
      if (!msg && status === 429) msg = backendMsg || 'Muitas tentativas. Aguarde alguns minutos.'
      if (!msg && err.response) msg = backendMsg || `Erro do servidor (${status})`
      if (!msg) msg = 'Não foi possível conectar ao servidor. Tente novamente.'
      setLoginError(msg)
    } finally {
      busyRef.current = false
      if (mountedRef.current) {
        setLoading(false)
        setLoginStage('')
      }
    }
  }
  return (
    <div className='min-h-[100dvh] flex flex-col justify-between bg-surface overflow-x-hidden'>
      <div className='p-7 flex-1'>
        <img className='h-16 object-contain mb-10' src="/movecity-logo.png" alt="MoveCity Motorista" width="500" height="500" />
        <form onSubmit={(e) => {
          submitHandler(e)
        }}>
          <label htmlFor="captain-login-email" className='block text-lg font-medium mb-2 text-ink-900'>Qual é o seu email?</label>
          <input
            id="captain-login-email"
            name="email"
            disabled={loading}
            ref={emailRef}
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
            }}
            className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 mb-7 rounded-panel px-4 py-3 w-full text-lg placeholder:text-ink-400 outline-none transition-colors'
            type="email"
            autoComplete="username"
            inputMode="email"
            placeholder='email@exemplo.com'
          />

          <label htmlFor="captain-login-password" className='block text-lg font-medium mb-2 text-ink-900'>Senha</label>

          <div className="relative mb-3">
          <input
            id="captain-login-password"
            name="password"
            ref={passwordRef}
            disabled={loading}
            aria-describedby={loginError ? 'captain-login-error' : undefined}
            className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 rounded-panel pl-4 pr-14 py-3 w-full text-lg placeholder:text-ink-400 outline-none transition-colors'
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
            }}
            required type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder='senha'
          />
          <button type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword}
            onClick={() => setShowPassword(value => !value)} className="absolute right-1 top-1 bottom-1 min-w-[44px] text-ink-700 rounded-panel focus-visible:outline focus-visible:outline-2">
            <i aria-hidden="true" className={showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} />
          </button>
          </div>

          {loginError && <p id="captain-login-error" role="alert" className="mb-3 rounded-panel bg-danger-50 p-3 text-danger-700">{loginError}</p>}
          <Link to="/captain-help?category=access" className="mb-3 inline-flex min-h-[44px] items-center underline text-brand-700">Esqueci a senha / preciso de ajuda</Link>

          <Button type="submit" loading={loading} className="mb-3 !bg-brand-700">
            {loading ? (loginStage || 'Entrando...') : 'Entrar'}
          </Button>

          {loading && (
            <p className="text-center text-xs text-ink-500 -mt-1 mb-3" role="status">
              No primeiro acesso, o servidor pode levar até um minuto para iniciar. Não feche o aplicativo.
            </p>
          )}

        </form>
        <p className='text-center text-ink-600'>Quer dirigir com a gente? <Link to='/captain-signup' className='text-brand-700 font-medium'>Cadastre-se como Motorista</Link></p>
        <div className="flex justify-center gap-4 mt-5 text-xs font-semibold text-ink-600">
          <Link to="/privacy">Privacidade</Link>
          <Link to="/captain-help">Suporte</Link>
          <Link to="/account-deletion">Excluir conta</Link>
        </div>
      </div>
      {/* Só na web: o APK motorista (VITE_APP_ROLE=driver) não tem rotas de passageiro. */}
      {getAppRole() === 'web' && (
        <div className='p-7'>
          <Link
            to='/login'
            className='bg-surface-alt border border-brand-100 flex items-center justify-center text-brand-700 font-semibold mb-5 rounded-panel px-4 py-3 w-full text-lg hover:bg-brand-50 transition-colors'
          >Entrar como Passageiro</Link>
        </div>
      )}
    </div>
  )
}

export default Captainlogin
