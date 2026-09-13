import { useState, useEffect, useContext, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@/shared/contexts/ToastContext'
import { getVehicleCategories } from '@/shared/services/vehicleCategoriesApi'
import Button from '@/shared/components/ui/Button'
import { saveSession, getAccessToken } from '@/shared/services/session'
import { syncTokenWithSW } from '@/shared/services/swCommunication'
import { isImageFile } from '@/shared/services/imageUpload'
import { withHardTimeout } from '@/shared/utils/hardTimeout'
import { registerCaptain, uploadCaptainSignupPhoto } from '@/driver/services/signupCaptain'

// Simplificação do cadastro do motorista (2026-08-04): o formulário inicial pede só
// conta (nome/e-mail/senha) e veículo — CPF, telefone, data de nascimento, CNH e PIX
// saíram daqui e passaram para a etapa de documentação (CaptainDocuments.jsx),
// acessível pelo perfil depois que a conta já existe. O motorista entra rápido e
// resolve a documentação depois, com até 5 dias (prazo calculado pelo backend).
const CaptainSignup = () => {

  const navigate = useNavigate()
  const mounted = useRef(false)
  const submitLock = useRef(false)
  const request = useRef(null)
  const categoriesRequest = useRef(0)

  useEffect(() => {
    mounted.current = true
    if (getAccessToken('captain')) {
      navigate('/captain-home')
    }
    return () => {
      mounted.current = false
      request.current?.abort()
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
  const [ stage, setStage ] = useState('')
  const [ registrationUncertain, setRegistrationUncertain ] = useState(false)
  const [ error, setError ] = useState('')
  const [ photoFile, setPhotoFile ] = useState(null)
  const [ photoPreview, setPhotoPreview ] = useState(null)

  const { setCaptain } = useContext(CaptainDataContext)
  const { addToast } = useToast()

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isImageFile(file)) {
      addToast('Selecione uma imagem válida.', 'error')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      addToast('A foto deve ter no máximo 5 MB.', 'error')
      return
    }
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onloadend = () => { if (mounted.current) setPhotoPreview(reader.result) }
    reader.readAsDataURL(file)
  }

  const [ vehicleCategories, setVehicleCategories ] = useState([])
  const [ categoriesStatus, setCategoriesStatus ] = useState('loading')
  const loadCategories = useCallback(async () => {
    const attempt = ++categoriesRequest.current
    setCategoriesStatus('loading')
    try {
      const categories = await withHardTimeout(getVehicleCategories())
      if (!Array.isArray(categories)) throw new Error('Catálogo inválido')
      if (!mounted.current || attempt !== categoriesRequest.current) return
      setVehicleCategories(categories)
      setVehicleType(previous => categories.some(category => category.name === previous) ? previous : '')
      setCategoriesStatus(categories.length ? 'ready' : 'empty')
    } catch {
      if (mounted.current && attempt === categoriesRequest.current) setCategoriesStatus('error')
    }
  }, [])
  useEffect(() => { void loadCategories() }, [loadCategories])

  const submitHandler = async (e) => {
    e.preventDefault()
    if (submitLock.current || registrationUncertain) return
    setError('')

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }

    if (categoriesStatus !== 'ready' || !vehicleCategories.some(category => category.name === vehicleType)) {
      setError('Carregue as categorias e selecione o veículo antes de criar a conta.')
      return
    }
    if (navigator.onLine === false) {
      setError('Sem internet. Conecte-se para criar sua conta. Seus dados foram mantidos.')
      return
    }

    submitLock.current = true
    setSubmitting(true)
    setStage('Criando conta...')
    request.current = new AbortController()
    const controller = request.current
    const sessionBefore = getAccessToken('captain')

    const captainData = {
      fullname: {
        firstname: firstName,
        lastname: lastName
      },
      email: email.trim().toLowerCase(),
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
      const data = await registerCaptain(captainData, { signal: controller.signal })
      if (!mounted.current || getAccessToken('captain') !== sessionBefore) return
      saveSession('captain', data)
      setCaptain(data.captain)
      syncTokenWithSW(data.token).catch(() => {})
      const isCurrent = () => mounted.current && getAccessToken('captain') === data.token

      // Foto de perfil: sobe depois do registro (precisa do JWT do motorista).
      if (photoFile) {
        setStage('Conta criada. Enviando foto...')
        try {
          const profilePicture = await uploadCaptainSignupPhoto(photoFile, data.token, data.captain._id, { signal: controller.signal })
          if (isCurrent()) setCaptain(previous => previous?._id === data.captain._id ? { ...previous, profilePicture } : previous)
        } catch {
          if (isCurrent()) addToast('Conta criada. Não foi possível confirmar a foto; confira ou reenvie pelo perfil.', 'warning', 5000)
        }
      }

      if (!isCurrent()) return
      addToast(`Conta criada, ${data.captain.fullname?.firstname || 'motorista'}! Envie sua documentação no perfil em até 5 dias.`, 'success', 6000)
      navigate('/captain-home')
    } catch (err) {
      if (!mounted.current || getAccessToken('captain') !== sessionBefore) return
      setRegistrationUncertain(Boolean(err.registrationUncertain))
      const message = err.registrationUncertain
        ? 'Não conseguimos confirmar a resposta. Sua conta pode ter sido criada. Tente entrar com o e-mail e a senha informados antes de fazer outro cadastro.'
        : err.response?.data?.errors?.[0]?.msg || err.response?.data?.message || 'Não foi possível criar a conta. Confira os dados e tente novamente.'
      setError(message)
      addToast(message, 'error')
    } finally {
      controller.abort()
      submitLock.current = false
      if (mounted.current) setSubmitting(false)
    }
  }

  return (
    <div className='py-5 px-5 min-h-screen flex flex-col justify-between bg-surface'>
      <div>
        <img className='h-16 object-contain mb-8' src="/movecity-logo.png" alt="MoveCity Motorista" width="500" height="500" />

        <h2 className='text-2xl font-bold text-ink-900 mb-2'>Cadastro de Motorista</h2>
        <p className='text-sm text-ink-600 mb-6'>Crie sua conta agora — a documentação você envia depois, direto pelo seu perfil.</p>

        <form onSubmit={submitHandler} className='space-y-8'>
          <fieldset disabled={submitting || registrationUncertain} className="space-y-8 min-w-0">

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

            <select required disabled={categoriesStatus !== 'ready'} aria-label="Categoria do Veículo" aria-describedby="vehicle-categories-status" className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-full rounded-panel px-4 py-3 outline-none mb-4' value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
              <option value="" disabled>Categoria do Veículo</option>
              {vehicleCategories.map((category) => (
                <option key={category.name} value={category.name}>{category.displayName}</option>
              ))}
            </select>
            {categoriesStatus !== 'ready' && <div id="vehicle-categories-status" className="mb-4 space-y-2">
              <p role={categoriesStatus === 'loading' ? 'status' : 'alert'} className="text-sm text-ink-700">
                {categoriesStatus === 'loading' ? 'Carregando categorias de veículo...'
                  : categoriesStatus === 'empty' ? 'Nenhuma categoria está disponível para cadastro no momento.'
                    : 'Não foi possível carregar as categorias. Verifique a conexão e tente novamente.'}
              </p>
              {categoriesStatus !== 'loading' && <button type="button" onClick={loadCategories} className="min-h-[44px] underline font-semibold text-brand-700">Tentar carregar categorias novamente</button>}
              {categoriesStatus === 'empty' && <Link to="/captain-help?category=documents" className="block min-h-[44px] underline text-brand-700">Pedir ajuda ao suporte</Link>}
            </div>}

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

          </fieldset>

          {error && (
            <div role="alert" className='flex items-center gap-2 bg-danger-50 border border-danger-500/30 rounded-panel p-3'>
              <i className="ri-error-warning-line text-danger-500"></i>
              <p className='text-sm text-danger-600'>{error}</p>
            </div>
          )}
          {registrationUncertain && <div className="flex flex-col gap-2">
            <Link to="/captain-login" className="min-h-[44px] flex items-center underline font-semibold text-brand-700">Conferir meu acesso</Link>
            <Link to="/captain-help?category=access" className="min-h-[44px] flex items-center underline text-brand-700">Preciso de ajuda com o cadastro</Link>
          </div>}

          <Button type="submit" loading={submitting} disabled={submitting || registrationUncertain || categoriesStatus !== 'ready' || !vehicleType} className="mb-3 shadow-floating">
            {submitting ? stage : 'Criar Conta'}
          </Button>

        </form>
        <p className='text-center text-ink-600 mt-6'>Já tem uma conta? <Link to='/captain-login' className='text-brand-600 font-medium'>Faça login aqui</Link></p>
      </div>
      <div>
        <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-brand-700">
          <Link to="/privacy" className="min-h-[44px] flex items-center underline">Política de Privacidade</Link>
          <Link to="/captain-help?category=documents" className="min-h-[44px] flex items-center underline">Ajuda com o cadastro</Link>
        </div>
      </div>
    </div>
  )
}

export default CaptainSignup
