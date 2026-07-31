import React, { useState, useContext, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { UserDataContext } from '@/contexts/UserContext'

import { useToast } from '@/contexts/ToastContext'
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { app } from '@/services/firebase';

const UserSignup = () => {
  const [ email, setEmail ] = useState('')
  const [ password, setPassword ] = useState('')
  const [ firstName, setFirstName ] = useState('')
  const [ lastName, setLastName ] = useState('')
  const [ cpf, setCpf ] = useState('')
  const [ phone, setPhone ] = useState('')

  const navigate = useNavigate()
  const { user, setUser } = useContext(UserDataContext)
  const { addToast } = useToast()

  useEffect(() => {
    if (localStorage.getItem('token')) {
      navigate('/home')
    }
  }, [navigate])

  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();

  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken();

      const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/users/google-login`, {
        idToken: idToken
      })

      if (response.status === 200 || response.status === 201) {
        const data = response.data
        setUser(data.user)
        localStorage.setItem('token', data.token)
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
      const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/users/register`, newUser)

      if (response.status === 201) {
        const data = response.data
        setUser(data.user)
        localStorage.setItem('token', data.token)
        addToast(`Conta criada com sucesso! Bem-vindo, ${data.user.fullname.firstname}! 🎉`, 'success')
        navigate('/home')
      }
    } catch (err) {
      addToast(err.response?.data?.errors?.[0]?.msg || err.response?.data?.message || 'Falha no cadastro', 'error')
    }

    setEmail('')
    setFirstName('')
    setLastName('')
    setCpf('')
    setPhone('')
    setPassword('')
  }
  return (
    <div>
      <div className='p-7 h-screen flex flex-col justify-between bg-white'>
        <div>
          <img className='h-16 object-contain mb-10' src="/movecity-logo.png" alt="MoveCity" />

          <form onSubmit={(e) => {
            submitHandler(e)
          }}>

            <h3 className='text-lg w-1/2 font-medium mb-2 text-gray-800'>Qual é o seu nome?</h3>
            <div className='flex gap-4 mb-7'>
              <input
                required
                className='bg-gray-50 text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 text-lg placeholder:text-gray-400 outline-none transition-colors'
                type="text"
                placeholder='Nome'
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value)
                }}
              />
              <input
                required
                className='bg-gray-50 text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 text-lg placeholder:text-gray-400 outline-none transition-colors'
                type="text"
                placeholder='Sobrenome'
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value)
                }}
              />
            </div>

            <h3 className='text-lg font-medium mb-2 text-gray-800'>Seus Documentos e Contato</h3>
            <div className='flex gap-4 mb-7'>
              <input
                required
                className='bg-gray-50 text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 text-lg placeholder:text-gray-400 outline-none transition-colors'
                type="text"
                placeholder='CPF (apenas números)'
                value={cpf}
                onChange={(e) => {
                  setCpf(e.target.value)
                }}
              />
              <input
                required
                className='bg-gray-50 text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 text-lg placeholder:text-gray-400 outline-none transition-colors'
                type="text"
                placeholder='Celular (ex: +5511999999999)'
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                }}
              />
            </div>

            <h3 className='text-lg font-medium mb-2 text-gray-800'>Qual é o seu email?</h3>
            <input
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
              }}
              className='bg-gray-50 text-gray-800 border border-gray-200 focus:border-green-500 mb-7 rounded-xl px-4 py-3 w-full text-lg placeholder:text-gray-400 outline-none transition-colors'
              type="email"
              placeholder='email@exemplo.com'
            />

            <h3 className='text-lg font-medium mb-2 text-gray-800'>Senha</h3>

            <input
              className='bg-gray-50 text-gray-800 border border-gray-200 focus:border-green-500 mb-7 rounded-xl px-4 py-3 w-full text-lg placeholder:text-gray-400 outline-none transition-colors'
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
              }}
              required type="password"
              placeholder='senha'
            />

            <button
              className='bg-green-500 hover:bg-green-600 text-white font-bold mb-3 rounded-xl px-4 py-3 w-full text-lg transition-colors shadow-lg shadow-green-500/20'
            >Criar conta</button>

          </form>

          <div className="relative flex items-center justify-center my-6">
            <hr className="w-full border-gray-200" />
            <span className="absolute px-3 bg-white text-gray-400 text-sm">ou</span>
          </div>

          <button
              type="button"
              onClick={handleGoogleLogin}
              className='bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold mb-5 rounded-xl px-4 py-3 w-full text-lg transition-colors flex items-center justify-center gap-3 shadow-sm'
          >
              <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className='w-6 h-6' />
              Entrar com o Google
          </button>
          <p className='text-center text-gray-500'>Já tem uma conta? <Link to='/login' className='text-green-600 font-medium'>Faça login aqui</Link></p>
        </div>
        <div>
          <p className='text-[10px] leading-tight text-gray-400'>Ao criar uma conta, você concorda com os <span className='underline text-green-500'>Termos de Uso</span> e a <span className='underline text-green-500'>Política de Privacidade</span> da MoveCity.</p>
        </div>
      </div>
    </div >
  )
}

export default UserSignup