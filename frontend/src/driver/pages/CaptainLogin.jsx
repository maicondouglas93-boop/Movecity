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
  const emailRef = useRef(null)
  const passwordRef = useRef(null)

  const { setCaptain } = useContext(CaptainDataContext)
  const navigate = useNavigate()
  const { addToast } = useToast()

  useEffect(() => {
    if (getAccessToken('captain')) {
      navigate('/captain-home')
    }
  }, [navigate])

  const submitHandler = async (e) => {
    e.preventDefault();
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
      const response = await loginCaptainReliably(captainData, { onStage: setLoginStage })

      if (response.status === 200) {
        const data = response.data

        setCaptain(data.captain)
        saveSession('captain', data)
        syncTokenWithSW(data.token)
        addToast(`Bem-vindo online, Motorista ${data.captain.fullname.firstname}!`, 'success')
        navigate('/captain-home')
        setEmail('')
        setPassword('')
      }
    } catch (err) {
      const status = err.response?.status
      const backendMsg = err.response?.data?.message
      let msg = err.friendlyMessage
      if (!msg && status === 401) msg = backendMsg || 'Email ou senha inválidos'
      if (!msg && status === 429) msg = backendMsg || 'Muitas tentativas. Aguarde alguns minutos.'
      if (!msg && err.response) msg = backendMsg || `Erro do servidor (${status})`
      if (!msg) msg = 'Não foi possível conectar ao servidor. Tente novamente.'
      console.error('[CaptainLogin] falha:', { status, code: err.code, message: err.message })
      addToast(msg, 'error')
    } finally {
      setLoading(false)
      setLoginStage('')
    }
  }
  return (
    <div className='h-screen flex flex-col justify-between bg-surface'>
      <div className='p-7 flex-1'>
        <img className='h-16 object-contain mb-10' src="/movecity-logo.png" alt="MoveCity Motorista" width="500" height="500" />
        <form onSubmit={(e) => {
          submitHandler(e)
        }}>
          <label htmlFor="captain-login-email" className='block text-lg font-medium mb-2 text-ink-900'>Qual é o seu email?</label>
          <input
            id="captain-login-email"
            name="email"
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

          <input
            id="captain-login-password"
            name="password"
            ref={passwordRef}
            className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 mb-7 rounded-panel px-4 py-3 w-full text-lg placeholder:text-ink-400 outline-none transition-colors'
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
            }}
            required type="password"
            autoComplete="current-password"
            placeholder='senha'
          />

          <Button type="submit" loading={loading} className="mb-3 shadow-floating">
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
          <Link to="/support">Suporte</Link>
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
