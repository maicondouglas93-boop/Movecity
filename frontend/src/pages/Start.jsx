
import React from 'react'
import { Link } from 'react-router-dom'

const Start = () => {
  return (
    <div>
      <div className='bg-cover bg-center bg-[url(/movecity-cover.jpg)] md:bg-none md:bg-white h-screen flex flex-col w-full pb-8 px-6'>
        {/* Espaçador para mobile (empurra o botão para baixo), Logo centralizada para desktop */}
        <div className='flex-1 flex items-center justify-center'>
          <img className='hidden md:block w-48 object-contain' src="/movecity-logo.png" alt="MoveCity" />
        </div>
        
        <Link to='/login' className='flex items-center justify-center w-full md:w-1/3 md:mx-auto bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-xl text-lg transition-colors shadow-lg shadow-green-500/20'>
          Começar
        </Link>
        
        {/* Botão discreto para área Admin */}
        <a href={`${import.meta.env.VITE_BASE_URL || 'http://localhost:3000'}/admin`} target="_blank" rel="noopener noreferrer" className="absolute top-4 right-4 p-2 text-gray-300 hover:text-green-500 opacity-30 hover:opacity-100 transition-all">
          <i className="ri-settings-4-line text-2xl"></i>
        </a>
      </div>
    </div>
  )
}

export default Start