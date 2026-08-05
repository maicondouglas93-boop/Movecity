import React from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/shared/components/ui/PageHeader'
import SelectableOptionCard from '@/shared/components/ui/SelectableOptionCard'

const ScheduleHub = () => {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-surface-alt flex flex-col">
      <PageHeader title="Agendar" onBack={() => navigate('/home')} />
      <main className="flex-1 px-4 py-5 max-w-xl mx-auto w-full space-y-3">
        <p className="text-sm text-ink-500 mb-2">
          Escolha o que deseja agendar. Começamos a buscar motorista cerca de 10 minutos antes do horário.
        </p>
        <SelectableOptionCard
          selected={false}
          onClick={() => navigate('/agendar/corrida')}
          icon={<i className="ri-taxi-line text-2xl text-ink-900" aria-hidden="true" />}
          title="Agendar corrida"
          subtitle="Viagem com data e hora"
        />
        <SelectableOptionCard
          selected={false}
          onClick={() => navigate('/encomenda', { state: { scheduleMode: true } })}
          icon={<i className="ri-box-3-line text-2xl text-ink-900" aria-hidden="true" />}
          title="Agendar encomenda"
          subtitle="Entrega com data e hora"
        />
        <button
          type="button"
          onClick={() => navigate('/scheduled')}
          className="w-full mt-4 min-h-[44px] text-sm font-medium text-brand-600 flex items-center justify-center gap-2"
        >
          <i className="ri-calendar-check-line text-lg" aria-hidden="true" />
          Ver meus agendamentos
        </button>
      </main>
    </div>
  )
}

export default ScheduleHub
