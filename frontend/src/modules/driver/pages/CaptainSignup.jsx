import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useToast } from '@/contexts/ToastContext'
import { getVehicleCategories } from '@/services/vehicleCategoriesApi'
import Button from '@/shared/components/ui/Button'
import { saveSession, getAccessToken } from '@/services/session'
import { syncTokenWithSW } from '@/services/swCommunication'

// Simplificação do cadastro do motorista (2026-08-04): o formulário inicial pede só
// conta (nome/e-mail/senha) e veículo — CPF, telefone, data de nascimento, CNH e PIX
// saíram daqui e passaram para a etapa de documentação (CaptainDocuments.jsx),
// acessível pelo perfil depois que a conta já existe. O motorista entra rápido e
// resolve a documentação depois, com até 5 dias (prazo calculado pelo backend).
const CaptainSignup = () => {

  const navigate = useNavigate()

  useEffect(() => {
    if (getAccessToken('captain')) {
      navigate('/captain-home')
    }
  }, [navigate])

  const [ firstName, setFirstName ] = useState('')
  const [ lastName, setLastName ] = useState('')
  const [ email, setEmail ] = useState('')
  const [ password, setPassword ] = useState('')
  const [ confirmPassword, setConfirmPassword ] = useState('')

  // Veículo
  const [ vehicleMarca, setVehicleMarca ] = useState('')
  const [ vehicleModelo, setVehicleModelo ] = useState('')
  const [ vehicleAno, setVehicleAno ] = useState('')
  const [ vehicleColor, setVehicleColor ] = useState('')
  const [ vehiclePlate, setVehiclePlate ] = useState('')
  const [ vehicleType, setVehicleType ] = useState('')

  const [ submitting, setSubmitting ] = useState(false)
  const [ error, setError ] = useState('')
  const [ photoFile, setPhotoFile ] = useState(null)
  const [ photoPreview, setPhotoPreview ] = useState(null)

  const { setCaptain } = React.useContext(CaptainDataContext)
  const { addToast } = useToast()

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      addToast('Selecione uma imagem válida.', 'error')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      addToast('A foto deve ter no máximo 5 MB.', 'error')
      return
    }
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setPhotoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  const [ vehicleCategories, setVehicleCategories ] = useState([])
  useEffect(() => {
    getVehicleCategories()
      .then(setVehicleCategories)
      .catch(() => setVehicleCategories([]))
  }, [])

  const submitHandler = async (e) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }

    setSubmitting(true)

    const captainData = {
      fullname: {
        firstname: firstName,
        lastname: lastName
      },
      email: email,
      password: password,
      vehicle: {
        marca: vehicleMarca,
        modelo: vehicleModelo,
        ano: vehicleAno,
        color: vehicleColor,
        plate: vehiclePlate,
        vehicleType: vehicleType
      }
    }

    try {
      const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/captains/register`, captainData)

      if (response.status === 201) {
        const data = response.data
        setCaptain(data.captain)
        saveSession('captain', data)
        syncTokenWithSW(data.token)

        // Foto de perfil: sobe depois do registro (precisa do JWT do motorista).
        if (photoFile) {
          try {
            const formData = new FormData()
            formData.append('image', photoFile)
            const uploadRes = await axios.post(
              `${import.meta.env.VITE_BASE_URL}/uploads/captain-profile`,
              formData,
              {
                headers: {
                  Authorization: `Bearer ${data.token}`,
                  'Content-Type': 'multipart/form-data',
                },
              }
            )
            if (uploadRes.data?.captain) {
              setCaptain(uploadRes.data.captain)
            }
          } catch (uploadErr) {
            console.warn('Foto de perfil não enviada no cadastro:', uploadErr)
            addToast('Conta criada, mas a foto não foi enviada. Você pode tentar de novo no perfil.', 'warning', 5000)
          }
        }

        addToast(`Conta criada, ${data.captain.fullname.firstname}! Envie sua documentação no perfil em até 5 dias.`, 'success', 6000)
        navigate('/captain-home')
      }
    } catch (err) {
      const message = err.response?.data?.errors?.[0]?.msg || err.response?.data?.message || 'Falha no cadastro'
      setError(message)
      addToast(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='py-5 px-5 min-h-screen flex flex-col justify-between bg-surface'>
      <div>
        <img className='h-16 object-contain mb-8' src="/movecity-logo.png" alt="MoveCity Motorista" width="500" height="500" />

        <h2 className='text-2xl font-bold text-ink-900 mb-2'>Cadastro de Motorista</h2>
        <p className='text-sm text-ink-600 mb-6'>Crie sua conta agora — a documentação você envia depois, direto pelo seu perfil.</p>

        <form onSubmit={submitHandler} className='space-y-8'>

          {/* SEÇÃO: CONTA */}
          <section className='p-4 bg-surface-alt rounded-panel border border-line shadow-raised'>
            <h3 className='text-lg font-semibold mb-4 text-brand-700 border-b border-brand-100 pb-2'>1. Conta</h3>

            <div className='flex flex-col items-center mb-5'>
              <div className='relative mb-2'>
                <div className='h-24 w-24 rounded-full bg-surface border-4 border-surface shadow-raised overflow-hidden flex items-center justify-center'>
                  {photoPreview ? (
                    <img src={photoPreview} alt='Foto de perfil' className='w-full h-full object-cover' />
                  ) : (
                    <i className='ri-user-fill text-5xl text-ink-400' aria-hidden='true' />
                  )}
                </div>
                <label
                  htmlFor='captain-photo-upload'
                  className='absolute bottom-0 right-0 bg-ink-900 text-white rounded-full h-9 w-9 flex items-center justify-center shadow-raised cursor-pointer active:scale-95 transition-transform border-2 border-surface'
                >
                  <i className='ri-camera-fill text-base' aria-hidden='true' />
                </label>
                <input
                  id='captain-photo-upload'
                  type='file'
                  accept='image/*'
                  className='hidden'
                  onChange={handlePhotoChange}
                />
              </div>
              <p className='text-sm text-ink-500 font-medium'>Foto de perfil</p>
            </div>

            <div className='flex gap-4 mb-4'>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" autoComplete="given-name" placeholder='Nome' aria-label='Nome' value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <input className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" autoComplete="family-name" placeholder='Sobrenome' aria-label='Sobrenome' value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>

            <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-full rounded-panel px-4 py-3 outline-none mb-4' type="email" autoComplete="email" placeholder='E-mail' aria-label='E-mail' value={email} onChange={(e) => setEmail(e.target.value)} />

            <input required minLength={6} className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-full rounded-panel px-4 py-3 outline-none mb-4' type="password" autoComplete="new-password" placeholder='Senha (mín. 6 caracteres)' aria-label='Senha' value={password} onChange={(e) => setPassword(e.target.value)} />

            <input required minLength={6} className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-full rounded-panel px-4 py-3 outline-none' type="password" autoComplete="new-password" placeholder='Confirmar senha' aria-label='Confirmar senha' value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </section>

          {/* SEÇÃO: VEÍCULO */}
          <section className='p-4 bg-surface-alt rounded-panel border border-line shadow-raised'>
            <h3 className='text-lg font-semibold mb-4 text-brand-700 border-b border-brand-100 pb-2'>2. Dados do Veículo</h3>

            <select required aria-label="Categoria do Veículo" className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-full rounded-panel px-4 py-3 outline-none mb-4' value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
              <option value="" disabled>Categoria do Veículo</option>
              {vehicleCategories.map((category) => (
                <option key={category.name} value={category.name}>{category.displayName}</option>
              ))}
            </select>

            <div className='flex gap-4 mb-4'>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Marca' aria-label='Marca' value={vehicleMarca} onChange={(e) => setVehicleMarca(e.target.value)} />
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Modelo' aria-label='Modelo' value={vehicleModelo} onChange={(e) => setVehicleModelo(e.target.value)} />
            </div>

            <div className='flex gap-4'>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/3 rounded-panel px-4 py-3 outline-none' type="number" placeholder='Ano' aria-label='Ano' value={vehicleAno} onChange={(e) => setVehicleAno(e.target.value)} />
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/3 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Cor' aria-label='Cor' value={vehicleColor} onChange={(e) => setVehicleColor(e.target.value)} />
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/3 rounded-panel px-4 py-3 outline-none uppercase' type="text" placeholder='Placa' aria-label='Placa' value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())} />
            </div>
          </section>

          {error && (
            <div className='flex items-center gap-2 bg-danger-50 border border-danger-500/30 rounded-panel p-3'>
              <i className="ri-error-warning-line text-danger-500"></i>
              <p className='text-sm text-danger-600'>{error}</p>
            </div>
          )}

          <Button type="submit" loading={submitting} disabled={submitting} className="mb-3 shadow-floating">
            {submitting ? 'Criando conta...' : 'Criar Conta'}
          </Button>

        </form>
        <p className='text-center text-ink-600 mt-6'>Já tem uma conta? <Link to='/captain-login' className='text-brand-600 font-medium'>Faça login aqui</Link></p>
      </div>
      <div>
        <p className='text-xs mt-6 leading-tight text-ink-600'>Este site é protegido pelo reCAPTCHA e as <span className='underline'>Políticas de Privacidade</span> e <span className='underline'>Termos de Serviço</span> do Google se aplicam.</p>
      </div>
    </div>
  )
}

export default CaptainSignup
