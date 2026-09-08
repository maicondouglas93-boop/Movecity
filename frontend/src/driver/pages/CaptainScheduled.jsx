import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { fetchDriverScheduled } from '@/driver/services/driverScheduled'
import PageHeader from '@/shared/components/ui/PageHeader'
import EmptyState from '@/shared/components/ui/EmptyState'
import { formatBRL } from '@/shared/utils/currency'

const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? formatBRL(value) : 'Indisponível'
const when = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  : 'Horário não informado'
const address = value => typeof value === 'string' && value.trim() ? value : 'Endereço não informado'
const vehicles = { moto: 'Moto', car: 'Carro', auto: 'Auto', bicycle: 'Bicicleta' }
const vehicle = value => typeof value === 'string' && value.trim() ? vehicles[value] || value : 'Veículo não informado'

export default function CaptainScheduled() {
  const navigate = useNavigate()
  const { captain } = useContext(CaptainDataContext)
  const { data: items, isFetching, isPending, isError, isPaused, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['captainScheduled', captain?._id],
    queryFn: ({ signal }) => fetchDriverScheduled(signal),
    enabled: Boolean(captain?._id), retry: false,
  })
  return <div className="h-full min-h-0 bg-surface-alt flex flex-col">
    <PageHeader title="Serviços agendados" onBack={() => navigate('/captain-home')} />
    <main className="flex-1 min-h-0 p-4 overflow-y-auto space-y-3">
      <p className="text-sm text-ink-600">
        Prévia das próximas 24 horas perto de você. Esta lista é só informativa —
        o aceite acontece quando a oferta real aparecer no app. Não é uma reserva.
      </p>
      {!captain?._id ? <p role="status">Aguardando a identificação da sua conta...</p> : <>
        <div role="status" className="text-sm text-ink-700">
          {isError ? items ? 'Não foi possível atualizar. Exibindo a última consulta válida.' : 'Não foi possível consultar os agendados.'
            : isPaused ? 'Sem conexão para consultar. Os dados exibidos podem estar desatualizados.'
              : isFetching ? 'Consultando agendados...' : ''}
        </div>
        {items && <p className="text-xs text-ink-600">Última consulta válida: {new Date(dataUpdatedAt).toLocaleString('pt-BR')}</p>}
        <button type="button" onClick={() => refetch()} disabled={isFetching || isPaused}
          className="min-h-[44px] px-4 rounded-panel border border-line font-semibold text-brand-700 disabled:opacity-50">
          {isFetching ? 'Consultando...' : 'Atualizar agendados'}
        </button>
        {!isPending && !isError && items?.length === 0 && <EmptyState icon="ri-calendar-todo-line"
          title="Nada agendado por perto"
          description="Quando houver serviços compatíveis com seu veículo na região, eles aparecem aqui. Fique online para receber as ofertas na hora." />}
        {items?.map(item => <article key={item.kind + item._id} className="bg-surface rounded-panel border border-line p-4 space-y-2 break-words">
          <h2 className="font-semibold text-ink-900">{item.kind === 'parcel' ? 'Encomenda' : 'Corrida'} · {vehicle(item.vehicleType)}</h2>
          <p className="text-sm text-ink-700">Ganho previsto: <strong>{money(item.driverAmount)}</strong></p>
          <p className="font-medium">{when(item.scheduledAt)}</p>
          {typeof item.itemName === 'string' && <p className="text-sm">Item: {item.itemName}</p>}
          <p className="text-sm text-ink-700">Retirada: {address(item.pickup)}</p>
          <p className="text-sm text-ink-700">Destino: {address(item.destination)}</p>
          <p className="text-sm text-ink-600">Aguarde a oferta no app. Horário e valor sujeitos à confirmação na oferta.</p>
        </article>)}
      </>}
    </main>
  </div>
}
