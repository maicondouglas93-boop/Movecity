import React, { useState, useContext, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import { UserDataContext } from '@/passenger/contexts/UserContext'

import { useToast } from '@/shared/contexts/ToastContext'
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { app } from '@/shared/services/firebase';
import Button from '@/shared/components/ui/Button'
import GoogleIcon from '@/shared/components/ui/GoogleIcon'
import { saveSession, getAccessToken } from '@/shared/services/session'
import { syncTokenWithSW } from '@/shared/services/swCommunication'

const UserSignup = () => {
  const [ email, setEmail ] = useState('')
  const [ password, setPassword ] = useState('')
  const [ firstName, setFirstName ] = useState('')
  const [ lastName, setLastName ] = useState('')
  const [ cpf, setCpf ] = useState('')
  const [ phone, setPhone ] = useState('')
  const [ loading, setLoading ] = useState(false)

  const navigate = useNavigate()
  const { user, setUser } = useContext(UserDataContext)
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
        addToast('Erro ao realizar login com o Google', 'error');
      }
    }
  };

  const submitHandler = async (e) => {
    e.preventDefault()
    setLoading(true)
    const newUser = {
      fullname: {
        firstname: firstName,
        lastname: lastName
      },
      cpf: cpf,
      phone: phone,
      email: email,
      password: password
    }

    try {
      const response = await api.post(`${import.meta.env.VITE_BASE_URL}/users/register`, newUser)

      if (response.status === 201) {
        const data = response.data
        setUser(data.user)
        saveSession('user', data)
        syncTokenWithSW(data.token)
        addToast(`Conta criada com sucesso! Bem-vindo, ${data.user.fullname.firstname}! 🎉`, 'success')
        navigate('/home')
      }
    } catch (err) {
      addToast(err.response?.data?.errors?.[0]?.msg || err.response?.data?.message || 'Falha no cadastro', 'error')
    }

    setLoading(false)
    setEmail('')
    setFirstName('')
    setLastName('')
    setCpf('')
    setPhone('')
    setPassword('')
  }
  return (
    <div>
      <div className='p-7 h-screen flex flex-col justify-between bg-surface'>
        <div>
          <img className='h-16 object-contain mb-10' src="/movecity-logo.png" alt="MoveCity" width="500" height="500" />

          <form onSubmit={(e) => {
            submitHandler(e)
          }}>

            <h3 className='text-lg w-1/2 font-medium mb-2 text-ink-900'>Qual é o seu nome?</h3>
            <div className='flex gap-4 mb-7'>
              <input
                required
                className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 text-lg placeholder:text-ink-400 outline-none transition-colors'
                type="text"
                placeholder='Nome'
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value)
                }}
              />
              <input
                required
                className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 text-lg placeholder:text-ink-400 outline-none transition-colors'
                type="text"
                placeholder='Sobrenome'
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value)
                }}
              />
            </div>

            <h3 className='text-lg font-medium mb-2 text-ink-900'>Seus Documentos e Contato</h3>
            <div className='flex gap-4 mb-7'>
              <input
                required
                className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 text-lg placeholder:text-ink-400 outline-none transition-colors'
                type="text"
                placeholder='CPF (apenas números)'
                value={cpf}
                onChange={(e) => {
                  setCpf(e.target.value)
                }}
              />
              <input
                required
                className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 text-lg placeholder:text-ink-400 outline-none transition-colors'
                type="text"
                placeholder='Celular (ex: +5511999999999)'
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                }}
              />
            </div>

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
              Criar conta
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
          <p className='text-center text-ink-400'>Já tem uma conta? <Link to='/login' className='text-brand-700 font-medium'>Faça login aqui</Link></p>
        </div>
        <div>
          <p className='text-[10px] leading-tight text-ink-400'>Ao criar uma conta, você concorda com os <span className='underline text-brand-700'>Termos de Uso</span> e a <span className='underline text-brand-700'>Política de Privacidade</span> da MoveCity.</p>
        </div>
      </div>
    </div>
  )
}

export default UserSignup
