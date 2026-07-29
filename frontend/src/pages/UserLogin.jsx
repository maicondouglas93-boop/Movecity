import React, { useState, useContext } from 'react'
import { Link } from 'react-router-dom'
import { UserDataContext } from '../context/UserContext'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

import { useToast } from '../context/ToastContext'
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { app } from '../firebase';

const UserLogin = () => {
  const [ email, setEmail ] = useState('')
  const [ password, setPassword ] = useState('')

  const { user, setUser } = useContext(UserDataContext)
  const navigate = useNavigate()
  const { addToast } = useToast()

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
    e.preventDefault();

    const userData = {
      email: email,
      password: password
    }

    try {
      const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/users/login`, userData)

      if (response.status === 200) {
        const data = response.data
        setUser(data.user)
        localStorage.setItem('token', data.token)
        addToast(`Bem-vindo de volta, ${data.user.fullname.firstname}! 👋`, 'success')
        navigate('/home')
      }
    } catch (err) {
      addToast(err.response?.data?.message || 'Email ou senha inválidos', 'error')
    }

    setEmail('')
    setPassword('')
  }

  return (
    <div className='h-screen flex flex-col justify-between bg-white'>
      <div className='p-7 flex-1'>
        <img className='h-16 object-contain mb-10' src="/movecity-logo.png" alt="MoveCity" />

        <form onSubmit={(e) => {
          submitHandler(e)
        }}>
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
          >Entrar</button>

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
        <p className='text-center text-gray-500'>Novo por aqui? <Link to='/signup' className='text-green-600 font-medium'>Criar uma conta</Link></p>
      </div>
      <div className='p-7'>
        <Link
          to='/captain-login'
          className='bg-gray-50 border border-green-200 flex items-center justify-center text-green-600 font-semibold mb-5 rounded-xl px-4 py-3 w-full text-lg hover:bg-green-50 transition-colors'
        >Entrar como Motorista</Link>
      </div>
    </div>
  )
}

export default UserLogin