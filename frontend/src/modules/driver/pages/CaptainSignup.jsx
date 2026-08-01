import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useToast } from '@/contexts/ToastContext'
import { getVehicleCategories } from '@/services/vehicleCategoriesApi'

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

  // Uploads (UI only)
  const [ cnhFrontFile, setCnhFrontFile ] = useState(null)
  const [ cnhBackFile, setCnhBackFile ] = useState(null)
  const [ crlvFile, setCrlvFile ] = useState(null)
  const [ vehicleFrontFile, setVehicleFrontFile ] = useState(null)
  const [ selfieFile, setSelfieFile ] = useState(null)

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
    
    // Future integration note: Here we would typically upload the files to S3/Cloudinary
    // and retrieve the URLs to send in the captainData.
    
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
        addToast(`Cadastro enviado! Sua conta está em análise, ${data.captain.fullname.firstname}. 🚀`, 'success')
        navigate('/captain-home')
      }
    } catch (err) {
      addToast(err.response?.data?.errors?.[0]?.msg || err.response?.data?.message || 'Falha no cadastro', 'error')
    }
  }

  // Helper for file inputs
  const FileInput = ({ label, file, setFile }) => (
    <div className='mb-4'>
        <label className='block text-sm font-medium text-gray-700 mb-1'>{label}</label>
        <input 
            type="file" 
            accept="image/*"
            onChange={(e) => setFile(e.target.files[0])}
            className='block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100'
        />
        {file && <p className='text-xs text-green-600 mt-1'>Selecionado: {file.name}</p>}
    </div>
  )

  return (
    <div className='py-5 px-5 min-h-screen flex flex-col justify-between bg-white'>
      <div>
        <img className='h-16 object-contain mb-8' src="/movecity-logo.png" alt="MoveCity Motorista" />
        
        <h2 className='text-2xl font-bold text-gray-800 mb-6'>Cadastro de Motorista</h2>

        <form onSubmit={submitHandler} className='space-y-8'>
          
          {/* SEÇÃO: DADOS PESSOAIS */}
          <section className='p-4 bg-gray-50 rounded-2xl border border-gray-100 shadow-sm'>
            <h3 className='text-lg font-semibold mb-4 text-green-700 border-b border-green-200 pb-2'>1. Dados Pessoais</h3>
            
            <div className='flex gap-4 mb-4'>
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none' type="text" placeholder='Nome' value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none' type="text" placeholder='Sobrenome' value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            
            <div className='flex gap-4 mb-4'>
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none' type="text" placeholder='CPF (só números)' value={cpf} onChange={(e) => setCpf(e.target.value)} />
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none text-sm' type="date" placeholder='Data de Nasc.' value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </div>

            <div className='flex gap-4 mb-4'>
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none' type="text" placeholder='Celular (+55...)' value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none' type="email" placeholder='E-mail' value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-full rounded-xl px-4 py-3 outline-none' type="password" placeholder='Senha de acesso' value={password} onChange={(e) => setPassword(e.target.value)} />
          </section>

          {/* SEÇÃO: CNH */}
          <section className='p-4 bg-gray-50 rounded-2xl border border-gray-100 shadow-sm'>
            <h3 className='text-lg font-semibold mb-4 text-green-700 border-b border-green-200 pb-2'>2. Carteira de Motorista (CNH)</h3>
            
            <div className='flex gap-4 mb-4'>
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none' type="text" placeholder='Número da CNH' value={cnhNumber} onChange={(e) => setCnhNumber(e.target.value)} />
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/4 rounded-xl px-4 py-3 outline-none' type="text" placeholder='Cat. (ex: AB)' value={cnhCategory} onChange={(e) => setCnhCategory(e.target.value)} />
              <input className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/4 rounded-xl px-4 py-3 outline-none' type="text" placeholder='UF' value={cnhUf} onChange={(e) => setCnhUf(e.target.value)} />
            </div>

            <div className='flex gap-4 mb-6 items-center'>
                <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none text-sm' type="date" value={cnhExpiration} onChange={(e) => setCnhExpiration(e.target.value)} />
                <label className='flex items-center gap-2 text-gray-700 cursor-pointer w-1/2 text-sm'>
                    <input type="checkbox" checked={cnhEar} onChange={(e) => setCnhEar(e.target.checked)} className='w-5 h-5 text-green-600 rounded focus:ring-green-500' />
                    <span>Exerce Atividade Remunerada</span>
                </label>
            </div>

            <FileInput label="Foto da CNH (Frente)" file={cnhFrontFile} setFile={setCnhFrontFile} />
            <FileInput label="Foto da CNH (Verso)" file={cnhBackFile} setFile={setCnhBackFile} />
            <FileInput label="Selfie segurando CNH" file={selfieFile} setFile={setSelfieFile} />
          </section>

          {/* SEÇÃO: VEÍCULO */}
          <section className='p-4 bg-gray-50 rounded-2xl border border-gray-100 shadow-sm'>
            <h3 className='text-lg font-semibold mb-4 text-green-700 border-b border-green-200 pb-2'>3. Dados do Veículo</h3>
            
            <div className='flex gap-4 mb-4'>
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none' type="text" placeholder='Marca' value={vehicleMarca} onChange={(e) => setVehicleMarca(e.target.value)} />
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none' type="text" placeholder='Modelo' value={vehicleModelo} onChange={(e) => setVehicleModelo(e.target.value)} />
            </div>

            <div className='flex gap-4 mb-4'>
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/3 rounded-xl px-4 py-3 outline-none' type="number" placeholder='Ano' value={vehicleAno} onChange={(e) => setVehicleAno(e.target.value)} />
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/3 rounded-xl px-4 py-3 outline-none' type="text" placeholder='Cor' value={vehicleColor} onChange={(e) => setVehicleColor(e.target.value)} />
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/3 rounded-xl px-4 py-3 outline-none' type="text" placeholder='Placa' value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} />
            </div>

            <div className='flex gap-4 mb-6'>
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none' type="number" placeholder='Capacidade (Passageiros)' value={vehicleCapacity} onChange={(e) => setVehicleCapacity(e.target.value)} />
              <select required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/2 rounded-xl px-4 py-3 outline-none' value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                <option value="" disabled>Tipo de Veículo</option>
                {vehicleCategories.map((category) => (
                  <option key={category.name} value={category.name}>{category.displayName}</option>
                ))}
              </select>
            </div>

            <FileInput label="Foto do CRLV (Documento)" file={crlvFile} setFile={setCrlvFile} />
            <FileInput label="Foto do Veículo (Frente)" file={vehicleFrontFile} setFile={setVehicleFrontFile} />
          </section>

          {/* SEÇÃO: FINANCEIRO */}
          <section className='p-4 bg-gray-50 rounded-2xl border border-gray-100 shadow-sm'>
            <h3 className='text-lg font-semibold mb-4 text-green-700 border-b border-green-200 pb-2'>4. Recebimento (PIX)</h3>
            
            <div className='flex gap-4'>
              <select required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-1/3 rounded-xl px-4 py-3 outline-none' value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value)}>
                <option value="" disabled>Tipo de Chave</option>
                <option value="cpf">CPF</option>
                <option value="celular">Celular</option>
                <option value="email">E-mail</option>
                <option value="aleatoria">Aleatória</option>
              </select>
              <input required className='bg-white text-gray-800 border border-gray-200 focus:border-green-500 w-2/3 rounded-xl px-4 py-3 outline-none' type="text" placeholder='Chave Pix' value={pixKey} onChange={(e) => setPixKey(e.target.value)} />
            </div>
          </section>

          <button
            className='bg-green-500 hover:bg-green-600 text-white font-bold mb-3 rounded-xl px-4 py-4 w-full text-lg transition-colors shadow-lg shadow-green-500/20'
          >Enviar Cadastro</button>

        </form>
        <p className='text-center text-gray-500 mt-6'>Já tem uma conta? <Link to='/captain-login' className='text-green-600 font-medium'>Faça login aqui</Link></p>
      </div>
      <div>
        <p className='text-[10px] mt-6 leading-tight text-gray-400'>Este site é protegido pelo reCAPTCHA e as <span className='underline'>Políticas de Privacidade</span> e <span className='underline'>Termos de Serviço</span> do Google se aplicam.</p>
      </div>
    </div>
  )
}

export default CaptainSignup