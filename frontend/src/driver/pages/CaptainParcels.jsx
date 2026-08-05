import React, { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import CaptainHeader from '@/driver/components/CaptainHeader'
import PageHeader from '@/shared/components/ui/PageHeader'
import Card from '@/shared/components/ui/Card'
import EmptyState from '@/shared/components/ui/EmptyState'
import StatusBadge from '@/shared/components/ui/StatusBadge'
import Button from '@/shared/components/ui/Button'
import { RideCardSkeleton } from '@/shared/components/ui/Skeleton'
import { RideContext } from '@/shared/contexts/RideContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { useToast } from '@/shared/contexts/ToastContext'
import {
    acceptParcel,
    getCaptainParcelHistory,
} from '@/shared/services/parcelApi'
import { vehicleLabels } from '@/shared/assets/vehicleAssets'

const ACTIVE_PARCEL_STATUSES = [
    'provider_accepted',
    'going_to_pickup',
    'arrived_pickup',
    'collected',
    'in_transit',
    'arrived_destination',
    'delivered',
]

function shortAddress(address) {
    if (!address || typeof address !== 'string') return 'Endereço indisponível'
    return address.split(',')[0]
}

function formatDateTime(value) {
    if (!value) return '—'
    return new Date(value).toLocaleString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function formatFare(parcel) {
    const value = parcel?.driverAmount ?? parcel?.fare
    if (value == null || Number.isNaN(Number(value))) return '—'
    return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function getStatusInfo(status) {
    switch (status) {
        case 'awaiting_provider':
            return { text: 'Aguardando aceite', tone: 'warning' }
        case 'provider_accepted':
            return { text: 'Aceita', tone: 'info' }
        case 'going_to_pickup':
            return { text: 'Indo à coleta', tone: 'info' }
        case 'arrived_pickup':
            return { text: 'Na coleta', tone: 'info' }
        case 'collected':
            return { text: 'Coletada', tone: 'info' }
        case 'in_transit':
            return { text: 'Em transporte', tone: 'info' }
        case 'arrived_destination':
            return { text: 'No destino', tone: 'info' }
        case 'delivered':
            return { text: 'Entregue', tone: 'success' }
        case 'finished':
            return { text: 'Finalizada', tone: 'success' }
        case 'cancelled':
            return { text: 'Cancelada', tone: 'danger' }
        case 'scheduled':
            return { text: 'Agendada', tone: 'neutral' }
        default:
            return { text: status || 'Desconhecido', tone: 'neutral' }
    }
}

const SIZE_LABEL = { small: 'Pequeno', medium: 'Médio', large: 'Grande' }

const SectionTitle = ({ children }) => (
    <h3 className="text-xs font-semibold tracking-wide text-ink-400 uppercase mb-3 mt-2">
        {children}
    </h3>
)

const ParcelRow = ({ parcel, footer = null, highlight = false }) => {
    const status = getStatusInfo(parcel.status)

    return (
        <Card
            shadow="raised"
            padding="p-4"
            className={highlight ? 'border-2 border-brand-500 bg-brand-50/40' : ''}
        >
            <div className="flex justify-between items-start gap-3 mb-3">
                <div className="flex flex-col gap-1">
                    <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
                    <span className="text-xs text-ink-400">{formatDateTime(parcel.createdAt)}</span>
                </div>
                <span className="text-sm font-semibold text-ink-900 shrink-0">{formatFare(parcel)}</span>
            </div>

            <p className="text-sm font-semibold text-ink-900 mb-2 truncate">
                {parcel.itemName || 'Encomenda'}
            </p>

            <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 mt-1" aria-hidden="true">
                    <div className="w-2 h-2 rounded-full bg-brand-500" />
                    <div className="w-0.5 h-6 bg-line" />
                    <div className="w-2 h-2 rounded-full bg-danger-500" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs text-ink-400 mb-0.5">Coleta</p>
                    <p className="text-sm font-medium text-ink-900 truncate mb-2">{shortAddress(parcel.pickup)}</p>
                    <p className="text-xs text-ink-400 mb-0.5">Entrega</p>
                    <p className="text-sm font-medium text-ink-900 truncate">{shortAddress(parcel.destination)}</p>
                </div>
            </div>

            <p className="text-xs text-ink-500 mt-3">
                {vehicleLabels[parcel.vehicleType] || parcel.vehicleType}
                {parcel.size ? ` · ${SIZE_LABEL[parcel.size] || parcel.size}` : ''}
                {parcel.weightKg != null ? ` · ${parcel.weightKg} kg` : ''}
            </p>

            {footer}
        </Card>
    )
}

const CaptainParcels = () => {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const { socket } = useContext(SocketContext)
    const { captainParcel, setCaptainParcel, syncCaptainParcel } = useContext(RideContext)
    const [acceptingId, setAcceptingId] = useState(null)

    const {
        data,
        isLoading,
        isError,
        refetch,
        isRefetching,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['captainParcelHistory'],
        queryFn: async ({ pageParam = 1 }) => getCaptainParcelHistory({ page: pageParam, limit: 20 }),
        getNextPageParam: (lastPage) => (lastPage?.hasNext ? lastPage.page + 1 : undefined),
        initialPageParam: 1,
    })

    const firstPage = data?.pages?.[0]
    const contextActive = captainParcel && ACTIVE_PARCEL_STATUSES.includes(captainParcel.status)
        ? captainParcel
        : null
    const apiActive = firstPage?.activeParcel && ACTIVE_PARCEL_STATUSES.includes(firstPage.activeParcel.status)
        ? firstPage.activeParcel
        : null
    const activeParcel = contextActive || apiActive
    const pendingOffers = firstPage?.pendingOffers || []
    const historyParcels = (data?.pages || []).flatMap((page) => page?.parcels || [])

    const hasNowSection = Boolean(activeParcel) || pendingOffers.length > 0
    const isEmpty = !hasNowSection && historyParcels.length === 0

    useEffect(() => {
        syncCaptainParcel?.()
        queryClient.invalidateQueries({ queryKey: ['captainParcelHistory'] })
    }, [syncCaptainParcel, queryClient])

    useEffect(() => {
        if (!socket) return undefined

        const refresh = () => {
            queryClient.invalidateQueries({ queryKey: ['captainParcelHistory'] })
            syncCaptainParcel?.()
        }

        const events = [
            'new-parcel',
            'parcel-taken',
            'parcel-confirmed',
            'parcel-status-updated',
            'parcel-cancelled',
            'parcel-finished',
        ]
        events.forEach((event) => socket.on(event, refresh))
        return () => {
            events.forEach((event) => socket.off(event, refresh))
        }
    }, [socket, queryClient, syncCaptainParcel])

    const handleAccept = async (parcel) => {
        if (!parcel?._id || acceptingId) return
        setAcceptingId(parcel._id)
        try {
            const accepted = await acceptParcel(parcel._id)
            setCaptainParcel(accepted)
            await queryClient.invalidateQueries({ queryKey: ['captainParcelHistory'] })
            addToast('Encomenda aceita.', 'success')
            navigate('/captain-parcel', { state: { parcel: accepted } })
        } catch (err) {
            if (err.response?.status === 409) {
                addToast('Essa encomenda já foi aceita por outro motorista.', 'info')
                queryClient.invalidateQueries({ queryKey: ['captainParcelHistory'] })
            } else {
                addToast(err.response?.data?.message || 'Não foi possível aceitar a encomenda.', 'error')
            }
        } finally {
            setAcceptingId(null)
        }
    }

    const handleReturn = async () => {
        const synced = await syncCaptainParcel?.()
        const target = (synced && synced._id) ? synced : activeParcel
        if (!target) return
        navigate('/captain-parcel', { state: { parcel: target } })
    }

    return (
        <div className="h-screen bg-surface-alt flex flex-col pt-24">
            <PageHeader title="Encomendas" onBack={() => navigate('/captain-home')} className="shadow-raised" />

            <div className="flex-1 overflow-y-auto p-4 pb-28">
                <div className="flex flex-col gap-4">
                    {activeParcel && (
                        <>
                            <SectionTitle>Agora</SectionTitle>
                            <ParcelRow
                                parcel={activeParcel}
                                highlight
                                footer={(
                                    <div className="mt-4">
                                        <Button onClick={handleReturn}>Continuar encomenda</Button>
                                    </div>
                                )}
                            />
                        </>
                    )}

                    {isLoading && !activeParcel ? (
                        <div aria-live="polite" aria-busy="true">
                            <p className="text-sm text-ink-500 mb-3">Carregando encomendas...</p>
                            <RideCardSkeleton />
                            <div className="mt-4"><RideCardSkeleton /></div>
                        </div>
                    ) : isError && !activeParcel ? (
                        <EmptyState
                            variant="error"
                            icon="ri-wifi-off-line"
                            title="Não foi possível carregar as encomendas"
                            description="Verifique sua conexão e tente novamente."
                            actionLabel={isRefetching ? 'Tentando...' : 'Tentar novamente'}
                            onAction={refetch}
                        />
                    ) : isEmpty ? (
                        <EmptyState
                            icon="ri-box-3-line"
                            title="Nenhuma encomenda por perto"
                            description="Quando houver entregas disponíveis no seu raio, ou após você finalizar alguma, elas aparecem aqui."
                        />
                    ) : (
                        <>
                            {pendingOffers.length > 0 && (
                                <>
                                    <SectionTitle>Disponíveis perto de você</SectionTitle>
                                    {pendingOffers.map((parcel) => (
                                        <ParcelRow
                                            key={parcel._id}
                                            parcel={parcel}
                                            footer={(
                                                <div className="mt-4">
                                                    <Button
                                                        loading={acceptingId === parcel._id}
                                                        disabled={Boolean(acceptingId)}
                                                        onClick={() => handleAccept(parcel)}
                                                    >
                                                        Aceitar encomenda
                                                    </Button>
                                                </div>
                                            )}
                                        />
                                    ))}
                                </>
                            )}

                            {historyParcels.length > 0 && (
                                <>
                                    <SectionTitle>Histórico</SectionTitle>
                                    {historyParcels.map((parcel) => (
                                        <ParcelRow key={parcel._id} parcel={parcel} />
                                    ))}
                                    {hasNextPage && (
                                        <Button
                                            variant="ghost"
                                            loading={isFetchingNextPage}
                                            onClick={() => fetchNextPage()}
                                        >
                                            Carregar mais
                                        </Button>
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
            <CaptainHeader />
        </div>
    )
}

export default CaptainParcels
