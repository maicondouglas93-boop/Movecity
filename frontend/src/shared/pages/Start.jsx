
import React, { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const Start = () => {
  const navigate = useNavigate()

  useEffect(() => {
    const token = localStorage.getItem('token')
    const captainToken = localStorage.getItem('captain-token')
    if (token) {
      navigate('/home')
    } else if (captainToken) {
      navigate('/captain-home')
    }
  }, [navigate])

  return (
    <div>
      {/* Uma única estratégia visual em todos os tamanhos de tela (antes trocava pra
          fundo branco só no desktop, misturando duas identidades pra mesma tela — ver
          §2.10 da auditoria de UX). */}
      <div className='bg-cover bg-center bg-[url(/movecity-cover.jpg)] h-screen flex flex-col w-full pb-8 px-6'>
        <div className='flex-1 flex items-center justify-center'>
          <img className='w-40 md:w-48 object-contain' src="/movecity-logo.png" alt="MoveCity" />
        </div>

        <Link
          to='/login'
          className='flex items-center justify-center w-full md:w-1/3 md:mx-auto min-h-[48px] bg-brand-500 active:bg-brand-600 text-white font-semibold rounded-panel py-4 text-lg transition-colors shadow-raised'
        >
          Começar
        </Link>

        {/* Botão discreto para área Admin */}
        <a
          href={`${import.meta.env.VITE_BASE_URL || 'http://localhost:3000'}/admin`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Área administrativa"
          className="absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 active:text-brand-500 opacity-30 active:opacity-100 transition-all"
        >
          <i className="ri-settings-4-line text-2xl" aria-hidden="true"></i>
        </a>
      </div>
    </div>
  )
}

export default Start
