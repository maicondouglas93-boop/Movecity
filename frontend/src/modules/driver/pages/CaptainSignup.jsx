import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useToast } from '@/contexts/ToastContext'
import { getVehicleCategories } from '@/services/vehicleCategoriesApi'
import Button from '@/shared/components/ui/Button'

const CaptainSignup = () => {

  const navigate = useNavigate()

  useEffect(() => {
    if (localStorage.getItem('captain-token')) {
      navigate('/captain-home')
    }
  }, [navigate])

  // Pessoais
  const [ firstName, setFirstName ] = useState('')
  const [ lastName, setLastName ] = useState('')
  const [ email, setEmail ] = useState('')
  const [ password, setPassword ] = useState('')
  const [ cpf, setCpf ] = useState('')
  const [ birthDate, setBirthDate ] = useState('')
  const [ phone, setPhone ] = useState('')

  // Documentos CNH
  const [ cnhNumber, setCnhNumber ] = useState('')
  const [ cnhCategory, setCnhCategory ] = useState('')
  const [ cnhExpiration, setCnhExpiration ] = useState('')
  const [ cnhUf, setCnhUf ] = useState('')
  const [ cnhEar, setCnhEar ] = useState(false)

  // Financeiro Pix
  const [ pixKeyType, setPixKeyType ] = useState('')
  const [ pixKey, setPixKey ] = useState('')

  // Veículo
  const [ vehicleMarca, setVehicleMarca ] = useState('')
  const [ vehicleModelo, setVehicleModelo ] = useState('')
  const [ vehicleAno, setVehicleAno ] = useState('')
  const [ vehicleColor, setVehicleColor ] = useState('')
  const [ vehiclePlate, setVehiclePlate ] = useState('')
  const [ vehicleCapacity, setVehicleCapacity ] = useState('')
  const [ vehicleType, setVehicleType ] = useState('')

  // Uploads
  const [ cnhFrontFile, setCnhFrontFile ] = useState(null)
  const [ cnhBackFile, setCnhBackFile ] = useState(null)
  const [ crlvFile, setCrlvFile ] = useState(null)
  const [ vehicleFrontFile, setVehicleFrontFile ] = useState(null)
  const [ selfieFile, setSelfieFile ] = useState(null)

  // Auditoria de UX do motorista (2026-08-02, §2.2): antes os 5 arquivos abaixo eram
  // aceitos pelo formulário e simplesmente descartados — o comentário original dizia
  // "Future integration note: aqui subiríamos os arquivos". Nenhum motorista conseguia
  // ser aprovado pelo próprio app porque os documentos nunca chegavam ao backend.
  const [ submitting, setSubmitting ] = useState(false)
  const [ uploadStep, setUploadStep ] = useState(null) // { current, total, label } | null

  const { captain, setCaptain } = React.useContext(CaptainDataContext)
  const { addToast } = useToast()

  const [ vehicleCategories, setVehicleCategories ] = useState([])
  useEffect(() => {
    getVehicleCategories()
      .then(setVehicleCategories)
      .catch(() => setVehicleCategories([]))
  }, [])

  const submitHandler = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    const captainData = {
      fullname: {
        firstname: firstName,
        lastname: lastName
      },
      email: email,
      password: password,
      cpf,
      birthDate,
      phone,
      cnh: {
        number: cnhNumber,
        category: cnhCategory,
        expiration: cnhExpiration,
        uf: cnhUf,
        ear: cnhEar
      },
      pix: {
        keyType: pixKeyType,
        key: pixKey
      },
      vehicle: {
        marca: vehicleMarca,
        modelo: vehicleModelo,
        ano: vehicleAno,
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

        // A conta já foi criada neste ponto — uma falha de upload não deve travar o
        // cadastro nem derrubar o motorista de volta pro formulário. Sequencial (não em
        // paralelo) pra poder mostrar "Enviando documento X de Y..." com precisão.
        const documents = [
          { docType: 'cnhFront', file: cnhFrontFile, label: 'CNH (frente)' },
          { docType: 'cnhBack', file: cnhBackFile, label: 'CNH (verso)' },
          { docType: 'crlv', file: crlvFile, label: 'CRLV' },
          { docType: 'vehicleFront', file: vehicleFrontFile, label: 'Foto do veículo' },
          { docType: 'selfie', file: selfieFile, label: 'Selfie com a CNH' },
        ].filter(doc => doc.file)

        const failedLabels = []
        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i]
          setUploadStep({ current: i + 1, total: documents.length, label: doc.label })
          try {
            const formData = new FormData()
            formData.append('image', doc.file)
            formData.append('docType', doc.docType)
            const uploadRes = await axios.post(`${import.meta.env.VITE_BASE_URL}/uploads/document`, formData, {
              headers: { Authorization: `Bearer ${data.token}` }
            })
            await axios.patch(`${import.meta.env.VITE_BASE_URL}/captains/documents`, {
              docType: doc.docType,
              url: uploadRes.data.url
            }, {
              headers: { Authorization: `Bearer ${data.token}` }
            })
          } catch (uploadErr) {
            console.error(`Falha ao enviar documento ${doc.docType}:`, uploadErr)
            failedLabels.push(doc.label)
          }
        }
        setUploadStep(null)

        if (failedLabels.length > 0) {
          addToast(`Cadastro criado, mas alguns documentos não foram enviados (${failedLabels.join(', ')}). Tente reenviá-los mais tarde.`, 'error')
        } else {
          addToast(`Cadastro enviado! Sua conta está em análise, ${data.captain.fullname.firstname}. 🚀`, 'success')
        }
        navigate('/captain-home')
      }
    } catch (err) {
      addToast(err.response?.data?.errors?.[0]?.msg || err.response?.data?.message || 'Falha no cadastro', 'error')
    } finally {
      setSubmitting(false)
      setUploadStep(null)
    }
  }

  // Helper for file inputs
  const FileInput = ({ id, label, file, setFile }) => (
    <div className='mb-4'>
        <label htmlFor={id} className='block text-sm font-medium text-ink-600 mb-1'>{label}</label>
        <input
            id={id}
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files[0])}
            className='block w-full text-sm text-ink-600 file:mr-4 file:py-2 file:px-4 file:rounded-panel file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100'
        />
        {file && <p className='text-xs text-brand-600 mt-1'>Selecionado: {file.name}</p>}
    </div>
  )

  return (
    <div className='py-5 px-5 min-h-screen flex flex-col justify-between bg-surface'>
      <div>
        <img className='h-16 object-contain mb-8' src="/movecity-logo.png" alt="MoveCity Motorista" />
        
        <h2 className='text-2xl font-bold text-ink-900 mb-6'>Cadastro de Motorista</h2>

        <form onSubmit={submitHandler} className='space-y-8'>
          
          {/* SEÇÃO: DADOS PESSOAIS */}
          <section className='p-4 bg-surface-alt rounded-panel border border-line shadow-raised'>
            <h3 className='text-lg font-semibold mb-4 text-brand-700 border-b border-brand-100 pb-2'>1. Dados Pessoais</h3>
            
            <div className='flex gap-4 mb-4'>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" autoComplete="given-name" placeholder='Nome' aria-label='Nome' value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" autoComplete="family-name" placeholder='Sobrenome' aria-label='Sobrenome' value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            
            <div className='flex gap-4 mb-4'>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" placeholder='CPF (só números)' aria-label='CPF (só números)' value={cpf} onChange={(e) => setCpf(e.target.value)} />
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none text-sm' type="date" placeholder='Data de Nasc.' aria-label='Data de Nasc.' value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>

            <div className='flex gap-4 mb-4'>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" autoComplete="tel" placeholder='Celular (+55...)' aria-label='Celular (+55...)' value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="email" autoComplete="email" placeholder='E-mail' aria-label='E-mail' value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-full rounded-panel px-4 py-3 outline-none' type="password" autoComplete="new-password" placeholder='Senha de acesso' aria-label='Senha de acesso' value={password} onChange={(e) => setPassword(e.target.value)} />
          </section>

          {/* SEÇÃO: CNH */}
          <section className='p-4 bg-surface-alt rounded-panel border border-line shadow-raised'>
            <h3 className='text-lg font-semibold mb-4 text-brand-700 border-b border-brand-100 pb-2'>2. Carteira de Motorista (CNH)</h3>
            
            <div className='flex gap-4 mb-4'>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Número da CNH' aria-label='Número da CNH' value={cnhNumber} onChange={(e) => setCnhNumber(e.target.value)} />
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/4 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Cat. (ex: AB)' aria-label='Cat. (ex: AB)' value={cnhCategory} onChange={(e) => setCnhCategory(e.target.value)} />
              <input className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/4 rounded-panel px-4 py-3 outline-none' type="text" placeholder='UF' aria-label='UF' value={cnhUf} onChange={(e) => setCnhUf(e.target.value)} />
            </div>

            <div className='flex gap-4 mb-6 items-center'>
                <input required aria-label="Validade da CNH" className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none text-sm' type="date" value={cnhExpiration} onChange={(e) => setCnhExpiration(e.target.value)} />
                <label className='flex items-center gap-2 text-ink-600 cursor-pointer w-1/2 text-sm'>
                    <input type="checkbox" checked={cnhEar} onChange={(e) => setCnhEar(e.target.checked)} className='w-5 h-5 text-brand-600 rounded focus:ring-brand-500' />
                    <span>Exerce Atividade Remunerada</span>
                </label>
            </div>

            <FileInput id="file-cnh-front" label="Foto da CNH (Frente)" file={cnhFrontFile} setFile={setCnhFrontFile} />
            <FileInput id="file-cnh-back" label="Foto da CNH (Verso)" file={cnhBackFile} setFile={setCnhBackFile} />
            <FileInput id="file-selfie" label="Selfie segurando CNH" file={selfieFile} setFile={setSelfieFile} />
          </section>

          {/* SEÇÃO: VEÍCULO */}
          <section className='p-4 bg-surface-alt rounded-panel border border-line shadow-raised'>
            <h3 className='text-lg font-semibold mb-4 text-brand-700 border-b border-brand-100 pb-2'>3. Dados do Veículo</h3>
            
            <div className='flex gap-4 mb-4'>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Marca' aria-label='Marca' value={vehicleMarca} onChange={(e) => setVehicleMarca(e.target.value)} />
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Modelo' aria-label='Modelo' value={vehicleModelo} onChange={(e) => setVehicleModelo(e.target.value)} />
            </div>

            <div className='flex gap-4 mb-4'>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/3 rounded-panel px-4 py-3 outline-none' type="number" placeholder='Ano' aria-label='Ano' value={vehicleAno} onChange={(e) => setVehicleAno(e.target.value)} />
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/3 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Cor' aria-label='Cor' value={vehicleColor} onChange={(e) => setVehicleColor(e.target.value)} />
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/3 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Placa' aria-label='Placa' value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} />
            </div>

            <div className='flex gap-4 mb-6'>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="number" placeholder='Capacidade (Passageiros)' aria-label='Capacidade (Passageiros)' value={vehicleCapacity} onChange={(e) => setVehicleCapacity(e.target.value)} />
              <select required aria-label="Tipo de Veículo" className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                <option value="" disabled>Tipo de Veículo</option>
                {vehicleCategories.map((category) => (
                  <option key={category.name} value={category.name}>{category.displayName}</option>
                ))}
              </select>
            </div>

            <FileInput id="file-crlv" label="Foto do CRLV (Documento)" file={crlvFile} setFile={setCrlvFile} />
            <FileInput id="file-vehicle-front" label="Foto do Veículo (Frente)" file={vehicleFrontFile} setFile={setVehicleFrontFile} />
          </section>

          {/* SEÇÃO: FINANCEIRO */}
          <section className='p-4 bg-surface-alt rounded-panel border border-line shadow-raised'>
            <h3 className='text-lg font-semibold mb-4 text-brand-700 border-b border-brand-100 pb-2'>4. Recebimento (PIX)</h3>
            
            <div className='flex gap-4'>
              <select required aria-label="Tipo de Chave Pix" className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-1/3 rounded-panel px-4 py-3 outline-none' value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value)}>
                <option value="" disabled>Tipo de Chave</option>
                <option value="cpf">CPF</option>
                <option value="celular">Celular</option>
                <option value="email">E-mail</option>
                <option value="aleatoria">Aleatória</option>
              </select>
              <input required className='bg-surface text-ink-900 border border-line focus:border-brand-500 w-2/3 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Chave Pix' aria-label='Chave Pix' value={pixKey} onChange={(e) => setPixKey(e.target.value)} />
            </div>
          </section>

          <Button type="submit" loading={submitting} disabled={submitting} className="mb-3 shadow-floating">
            {uploadStep
              ? `Enviando documento ${uploadStep.current} de ${uploadStep.total}...`
              : submitting ? 'Enviando cadastro...' : 'Enviar Cadastro'}
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