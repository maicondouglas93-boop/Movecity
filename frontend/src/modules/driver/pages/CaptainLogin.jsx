import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import Button from '@/shared/components/ui/Button'

import { useToast } from '@/contexts/ToastContext'
import { saveSession } from '@/services/session'
import { syncTokenWithSW } from '@/services/swCommunication'

const Captainlogin = () => {

  const [ email, setEmail ] = useState('')
  const [ password, setPassword ] = useState('')
  const [ loading, setLoading ] = useState(false)

  const { captain, setCaptain } = React.useContext(CaptainDataContext)
  const navigate = useNavigate()
  const { addToast } = useToast()

  useEffect(() => {
    if (localStorage.getItem('captain-token')) {
      navigate('/captain-home')
    }
  }, [navigate])

  const submitHandler = async (e) => {
    e.preventDefault();
    setLoading(true)
    const captainData = {
      email: email,
      password
    }

    try {
      const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/captains/login`, captainData)

      if (response.status === 200) {
        const data = response.data

        setCaptain(data.captain)
        saveSession('captain', data)
        syncTokenWithSW(data.token)
        addToast(`Bem-vindo online, Motorista ${data.captain.fullname.firstname}! 🚗`, 'success')
        navigate('/captain-home')
      }
    } catch (err) {
      addToast(err.response?.data?.message || 'Email ou senha inválidos', 'error')
    } finally {
      setLoading(false)
    }

    setEmail('')
    setPassword('')
  }
  return (
    <div className='h-screen flex flex-col justify-between bg-surface'>
      <div className='p-7 flex-1'>
        <img className='h-16 object-contain mb-10' src="/movecity-logo.png" alt="MoveCity Motorista" />

        <form onSubmit={(e) => {
          submitHandler(e)
        }}>
          <label htmlFor="captain-login-email" className='block text-lg font-medium mb-2 text-ink-900'>Qual é o seu email?</label>
          <input
            id="captain-login-email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
            }}
            className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 mb-7 rounded-panel px-4 py-3 w-full text-lg placeholder:text-ink-400 outline-none transition-colors'
            type="email"
            autoComplete="email"
            placeholder='email@exemplo.com'
          />

          <label htmlFor="captain-login-password" className='block text-lg font-medium mb-2 text-ink-900'>Senha</label>

          <input
            id="captain-login-password"
            className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 mb-7 rounded-panel px-4 py-3 w-full text-lg placeholder:text-ink-400 outline-none transition-colors'
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
            }}
            required type="password"
            autoComplete="current-password"
            placeholder='senha'
          />

          <Button type="submit" loading={loading} className="mb-3 shadow-floating">Entrar</Button>

        </form>
        <p className='text-center text-ink-600'>Quer dirigir com a gente? <Link to='/captain-signup' className='text-brand-700 font-medium'>Cadastre-se como Motorista</Link></p>
      </div>
      <div className='p-7'>
        <Link
          to='/login'
          className='bg-surface-alt border border-brand-100 flex items-center justify-center text-brand-700 font-semibold mb-5 rounded-panel px-4 py-3 w-full text-lg hover:bg-brand-50 transition-colors'
        >Entrar como Passageiro</Link>
      </div>
    </div>
  )
}

export default Captainlogin
