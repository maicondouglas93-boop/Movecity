import { useState, useContext, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { UserDataContext } from '@/passenger/contexts/UserContext'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'

import { useToast } from '@/shared/contexts/ToastContext'
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { app } from '@/shared/services/firebase';
import Button from '@/shared/components/ui/Button'
import GoogleIcon from '@/shared/components/ui/GoogleIcon'
import { saveSession, getAccessToken } from '@/shared/services/session'
import { syncTokenWithSW } from '@/shared/services/swCommunication'

const UserLogin = () => {
  const [ email, setEmail ] = useState('')
  const [ password, setPassword ] = useState('')
  const [ loading, setLoading ] = useState(false)

  const { setUser } = useContext(UserDataContext)
  const navigate = useNavigate()
  const { addToast } = useToast()

  useEffect(() => {
    if (getAccessToken('user')) {
      navigate('/home')
    }
  }, [navigate])

  const auth = app ? getAuth(app) : null;
  const provider = new GoogleAuthProvider();

  const handleGoogleLogin = async () => {
    if (!auth) {
      addToast('Login com Google indisponível neste ambiente', 'error');
      return;
    }
    try {
      const result = await signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken();

      const response = await api.post(`${import.meta.env.VITE_BASE_URL}/users/google-login`, {
        idToken: idToken
      })

      if (response.status === 200 || response.status === 201) {
        const data = response.data
        setUser(data.user)
        saveSession('user', data)
        syncTokenWithSW(data.token)
        addToast(`Bem-vindo, ${data.user.fullname.firstname}! 👋`, 'success')
        navigate('/home')
      }
    } catch (error) {
      console.error('Google login error:', error);
      if (error.code !== 'auth/popup-closed-by-user') {
        const backendError = error.response?.data?.error || error.response?.data?.message || error.message;
        addToast(`Erro no Google: ${backendError}`, 'error');
      }
    }
  };

  const submitHandler = async (e) => {
    e.preventDefault();
    setLoading(true)

    const userData = {
      email: email,
      password: password
    }

    try {
      const response = await api.post(`${import.meta.env.VITE_BASE_URL}/users/login`, userData)

      if (response.status === 200) {
        const data = response.data
        setUser(data.user)
        saveSession('user', data)
        syncTokenWithSW(data.token)
        addToast(`Bem-vindo de volta, ${data.user.fullname.firstname}! 👋`, 'success')
        navigate('/home')
      }
    } catch (err) {
      addToast(err.response?.data?.message || 'Email ou senha inválidos', 'error')
    }

    setLoading(false)
    setEmail('')
    setPassword('')
  }

  return (
    <div className='h-screen flex flex-col justify-between bg-surface'>
      <div className='p-7 flex-1'>
        <img className='h-16 object-contain mb-10' src="/movecity-logo.png" alt="MoveCity" width="500" height="500" />

        <form onSubmit={(e) => {
          submitHandler(e)
        }}>
          <h3 className='text-lg font-medium mb-2 text-ink-900'>Qual é o seu email?</h3>
          <input
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
            }}
            className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 mb-7 rounded-panel px-4 py-3 w-full text-lg placeholder:text-ink-400 outline-none transition-colors'
            type="email"
            placeholder='email@exemplo.com'
          />

          <h3 className='text-lg font-medium mb-2 text-ink-900'>Senha</h3>

          <input
            className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 mb-7 rounded-panel px-4 py-3 w-full text-lg placeholder:text-ink-400 outline-none transition-colors'
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
            }}
            required type="password"
            placeholder='senha'
          />

          <Button type="submit" loading={loading} className='mb-3'>
            Entrar
          </Button>
        </form>

        <div className="relative flex items-center justify-center my-6">
          <hr className="w-full border-line" />
          <span className="absolute px-3 bg-surface text-ink-400 text-sm">ou</span>
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={handleGoogleLogin}
          className='mb-5 flex items-center justify-center gap-3'
        >
          <GoogleIcon />
          Entrar com o Google
        </Button>
        <p className='text-center text-ink-400'>Novo por aqui? <Link to='/signup' className='text-brand-700 font-medium'>Criar uma conta</Link></p>
        <div className="flex justify-center gap-4 mt-5 text-xs font-semibold text-ink-600">
          <Link to="/privacy">Privacidade</Link>
          <Link to="/support">Suporte</Link>
          <Link to="/account-deletion">Excluir conta</Link>
        </div>
      </div>
      <div className='p-7'>
        <Link
          to='/captain-login'
          className='bg-surface-alt border border-brand-200 flex items-center justify-center text-brand-700 font-semibold mb-5 rounded-panel px-4 py-3 w-full text-lg active:bg-brand-50 transition-colors'
        >Entrar como Motorista</Link>
      </div>
    </div>
  )
}

export default UserLogin
