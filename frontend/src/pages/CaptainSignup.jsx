import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { CaptainDataContext } from '../context/CapatainContext'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

import { useToast } from '../context/ToastContext'

const CaptainSignup = () => {

  const navigate = useNavigate()

  const [ email, setEmail ] = useState('')
  const [ password, setPassword ] = useState('')
  const [ firstName, setFirstName ] = useState('')
  const [ lastName, setLastName ] = useState('')

  const [ vehicleColor, setVehicleColor ] = useState('')
  const [ vehiclePlate, setVehiclePlate ] = useState('')
  const [ vehicleCapacity, setVehicleCapacity ] = useState('')
  const [ vehicleType, setVehicleType ] = useState('')


  const { captain, setCaptain } = React.useContext(CaptainDataContext)
  const { addToast } = useToast()

  const submitHandler = async (e) => {
    e.preventDefault()
    const captainData = {
      fullname: {
        firstname: firstName,
        lastname: lastName
      },
      email: email,
      password: password,
      vehicle: {
        color: vehicleColor,
        plate: vehiclePlate,
        capacity: vehicleCapacity,
        vehicleType: vehicleType
      }
    }

    try {
      const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/captains/register`, captainData)

      if (response.status === 201) {
        const data = response.data
        setCaptain(data.captain)
        localStorage.setItem('captain-token', data.token)
        addToast(`Conta criada! Bem-vindo online, Motorista ${data.captain.fullname.firstname}! 🚀`, 'success')
        navigate('/captain-home')
      }
    } catch (err) {
      addToast(err.response?.data?.errors?.[0]?.msg || err.response?.data?.message || 'Falha no cadastro', 'error')
    }

    setEmail('')
    setFirstName('')
    setLastName('')
    setPassword('')
    setVehicleColor('')
    setVehiclePlate('')
    setVehicleCapacity('')
    setVehicleType('')

  }
  return (
    <div className='py-5 px-5 h-screen flex flex-col justify-between bg-white'>
      <div>
        <img className='h-16 object-contain mb-10' src="/movecity-logo.png" alt="MoveCity Motorista" />

        <form onSubmit={(e) => {
          submitHandler(e)
        }}>

          <h3 className='text-lg w-full font-medium mb-2 text-gray-800'>Qual é o seu nome?</h3>
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

          <h3 className='text-lg font-medium mb-2 text-gray-800'>Informações do Veículo</h3>
          <div className='flex gap-4 mb-7'>
            <input
              required
              className='bg-gray-50 text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 text-lg placeholder:text-gray-400 outline-none transition-colors'
              type="text"
              placeholder='Cor do Veículo'
              value={vehicleColor}
              onChange={(e) => {
                setVehicleColor(e.target.value)
              }}
            />
            <input
              required
              className='bg-gray-50 text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 text-lg placeholder:text-gray-400 outline-none transition-colors'
              type="text"
              placeholder='Placa do Veículo'
              value={vehiclePlate}
              onChange={(e) => {
                setVehiclePlate(e.target.value)
              }}
            />
          </div>
          <div className='flex gap-4 mb-7'>
            <input
              required
              className='bg-gray-50 text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 text-lg placeholder:text-gray-400 outline-none transition-colors'
              type="number"
              placeholder='Capacidade'
              value={vehicleCapacity}
              onChange={(e) => {
                setVehicleCapacity(e.target.value)
              }}
            />
            <select
              required
              className='bg-gray-50 text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 text-lg outline-none transition-colors'
              value={vehicleType}
              onChange={(e) => {
                setVehicleType(e.target.value)
              }}
            >
              <option value="" disabled>Selecione o Tipo</option>
              <option value="car">Carro</option>
              <option value="auto">Triciclo/Auto</option>
              <option value="moto">Moto</option>
            </select>
          </div>

          <button
            className='bg-green-500 hover:bg-green-600 text-white font-bold mb-3 rounded-xl px-4 py-3 w-full text-lg transition-colors shadow-lg shadow-green-500/20'
          >Criar Conta de Motorista</button>

        </form>
        <p className='text-center text-gray-500'>Já tem uma conta? <Link to='/captain-login' className='text-green-600 font-medium'>Faça login aqui</Link></p>
      </div>
      <div>
        <p className='text-[10px] mt-6 leading-tight text-gray-400'>Este site é protegido pelo reCAPTCHA e as <span className='underline'>Políticas de Privacidade</span> e <span className='underline'>Termos de Serviço</span> do Google se aplicam.</p>
      </div>
    </div>
  )
}

export default CaptainSignup