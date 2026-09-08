import { useContext, useState } from 'react'
import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import PageHeader from '@/shared/components/ui/PageHeader'
import Card from '@/shared/components/ui/Card'
import EmptyState from '@/shared/components/ui/EmptyState'
import { RideCardSkeleton } from '@/shared/components/ui/Skeleton'
import { formatBRL } from '@/shared/utils/currency'
import { EARNINGS_RANGES, fetchDriverEarnings, isEarningsNumber } from '@/driver/services/driverEarnings'

const money = value => isEarningsNumber(value) ? formatBRL(value) : 'Indisponível'
const updatedLabel = timestamp => timestamp > 0
    ? new Date(timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

function EarningsSummary({ query, title, retryLabel }) {
    const { data, isPending, isError, isFetching, isPaused, dataUpdatedAt, refetch } = query
    const waiting = isPending && !data
    return <section aria-label={title} className="rounded-panel border border-line bg-surface p-5 mb-4">
        <h2 className="font-semibold text-ink-900">{title}</h2>
        <p className="mt-2 text-sm text-ink-600">Líquido das corridas finalizadas</p>
        <p className={`${isEarningsNumber(data?.totalEarnings) ? 'text-3xl' : 'text-xl'} font-bold text-ink-900 break-words`} aria-live="off">
            {waiting && !isPaused ? 'Carregando...' : money(data?.totalEarnings)}
        </p>
        {data && <>
            <p className="text-sm text-ink-600 mt-1">{data.totalRides} {data.totalRides === 1 ? 'corrida' : 'corridas'}</p>
            <p className="mt-3 text-xs text-ink-600">Última consulta válida: {updatedLabel(dataUpdatedAt)}</p>
        </>}
        <div role="status" className="mt-3 text-sm text-ink-600">
            {isError ? (data
                ? 'Não foi possível atualizar. Exibindo a última consulta válida deste período.'
                : 'Não foi possível consultar estes ganhos. O valor está indisponível, não zerado.')
                : isPaused ? 'Sem conexão para consultar. Os dados exibidos podem estar desatualizados.'
                    : isFetching && data ? 'Atualizando dados...' : ''}
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching || isPaused}
            className="mt-2 min-h-[44px] rounded-panel border border-line px-4 font-semibold text-brand-700 disabled:opacity-50">
            {isFetching ? 'Consultando...' : retryLabel}
        </button>
    </section>
}
EarningsSummary.propTypes = { query: PropTypes.object.isRequired, title: PropTypes.string.isRequired, retryLabel: PropTypes.string.isRequired }

export default function CaptainEarnings() {
    const { captain } = useContext(CaptainDataContext)
    const captainId = captain?._id
    const [range, setRange] = useState('day')
    const [showLifetime, setShowLifetime] = useState(false)
    const period = EARNINGS_RANGES.find(item => item.value === range)
    const earnings = useQuery({
        queryKey: ['captainEarnings', captainId, range],
        queryFn: ({ signal }) => fetchDriverEarnings(range, signal),
        enabled: Boolean(captainId), retry: false,
    })
    const lifetime = useQuery({
        queryKey: ['captainEarnings', captainId, 'all'],
        queryFn: ({ signal }) => fetchDriverEarnings('all', signal),
        enabled: Boolean(captainId) && showLifetime, retry: false,
    })
    const { data } = earnings

    return <div className="h-full min-h-0 bg-surface-alt flex flex-col">
        <PageHeader title="Ganhos" className="shadow-raised" />
        <main className="flex-1 min-h-0 overflow-y-auto p-4 pb-6">
            {!captainId ? <p role="status">Aguardando a identificação da sua conta...</p> : <>
                <div role="group" aria-label="Período dos ganhos" className="flex gap-2 mb-4">
                    {EARNINGS_RANGES.map(item => <button key={item.value} type="button"
                        aria-pressed={range === item.value} onClick={() => setRange(item.value)}
                        className={`flex-1 min-h-[44px] rounded-panel px-2 text-sm font-semibold ${range === item.value ? 'bg-brand-700 text-white' : 'bg-surface text-ink-700 border border-line'}`}>
                        {item.label}
                    </button>)}
                </div>
                <EarningsSummary query={earnings} title={period.title} retryLabel="Atualizar período" />
                <p className="mb-5 text-sm text-ink-600">Estes ganhos incluem somente corridas, já descontada a comissão. Não representam saldo disponível para saque. <Link className="underline text-brand-700" to="/captain-wallet">Ver carteira</Link></p>

                <h2 className="font-semibold text-ink-900 mb-3">Corridas do período</h2>
                {earnings.isPending && !earnings.isPaused ? <RideCardSkeleton />
                    : !data ? <p className="text-sm text-ink-600 mb-5">A lista aparecerá quando a consulta estiver disponível.</p>
                        : data.rides.length === 0 ? <EmptyState icon="ri-car-line" title="Nenhuma corrida no período"
                            description="Corridas finalizadas neste recorte aparecem aqui com o valor líquido." />
                            : <div className="space-y-3 mb-5">{data.rides.map(ride => <Card key={ride.rideId} shadow="raised" padding="p-4">
                                <p className="text-sm font-medium text-ink-900 break-words">{ride.pickup || 'Origem indisponível'}</p>
                                <p className="text-sm text-ink-600 break-words">→ {ride.destination || 'Destino indisponível'}</p>
                                <p className="text-xs text-ink-600 mt-2">{Number.isFinite(Date.parse(ride.date)) ? new Date(ride.date).toLocaleDateString('pt-BR') : 'Data indisponível'}</p>
                                <div className="flex flex-wrap justify-between gap-2 text-sm border-t border-line pt-2 mt-2">
                                    <span>Ganho líquido</span><span className="font-semibold text-brand-700">{money(ride.driverAmount ?? ride.netEarnings)}</span>
                                </div>
                            </Card>)}</div>}

                <details className="mt-5 rounded-panel border border-line bg-surface p-4" onToggle={event => setShowLifetime(event.currentTarget.open)}>
                    <summary className="min-h-[44px] cursor-pointer font-semibold text-ink-900">Ganhos acumulados</summary>
                    {showLifetime && <EarningsSummary query={lifetime} title="Total líquido acumulado" retryLabel="Atualizar acumulado" />}
                </details>
            </>}
        </main>
    </div>
}
