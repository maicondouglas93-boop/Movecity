import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { CaptainDataContext } from '../context/CapatainContext'

import { useToast } from '../context/ToastContext'

const Captainlogin = () => {

  const [ email, setEmail ] = useState('')
  const [ password, setPassword ] = useState('')

  const { captain, setCaptain } = React.useContext(CaptainDataContext)
  const navigate = useNavigate()
  const { addToast } = useToast()

  const submitHandler = async (e) => {
    e.preventDefault();
    const captainData = {
      email: email,
      password
    }

    try {
      const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/captains/login`, captainData)

      if (response.status === 200) {
        const data = response.data

        setCaptain(data.captain)
        localStorage.setItem('captain-token', data.token)
        addToast(`Bem-vindo online, Motorista ${data.captain.fullname.firstname}! 🚗`, 'success')
        navigate('/captain-home')
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
        <img className='h-16 object-contain mb-10' src="/movecity-logo.png" alt="MoveCity Motorista" />

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
        <p className='text-center text-gray-500'>Quer dirigir com a gente? <Link to='/captain-signup' className='text-green-600 font-medium'>Cadastre-se como Motorista</Link></p>
      </div>
      <div className='p-7'>
        <Link
          to='/login'
          className='bg-gray-50 border border-green-200 flex items-center justify-center text-green-600 font-semibold mb-5 rounded-xl px-4 py-3 w-full text-lg hover:bg-green-50 transition-colors'
        >Entrar como Passageiro</Link>
      </div>
    </div>
  )
}

export default Captainlogin