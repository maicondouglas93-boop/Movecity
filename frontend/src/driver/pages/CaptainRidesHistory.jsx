import React, { useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import CaptainHeader from '@/driver/components/CaptainHeader';
import PageHeader from '@/shared/components/ui/PageHeader';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import StatusBadge from '@/shared/components/ui/StatusBadge';
import Button from '@/shared/components/ui/Button';
import { RideCardSkeleton } from '@/shared/components/ui/Skeleton';
import { getAccessToken } from '@/shared/services/session';
import { RideContext } from '@/shared/contexts/RideContext';
import { SocketContext } from '@/shared/contexts/SocketContext';
import { useToast } from '@/shared/contexts/ToastContext';

const ACTIVE_STATUSES = [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started' ];

function shortAddress(address) {
    if (!address || typeof address !== 'string') return 'Endereço indisponível';
    return address.split(',')[0];
}

function formatDateTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatFare(ride) {
    const value = ride?.driverAmount ?? ride?.finalPrice ?? ride?.fare;
    if (value == null || Number.isNaN(Number(value))) return '—';
    return `R$ ${Number(value).toFixed(2)}`;
}

// Rótulos amigáveis — status reais do Backend/models/ride.model.js (não inventar enum).
function getStatusInfo(status) {
    switch (status) {
        case 'requested':
            return { text: 'Aguardando aceite', tone: 'warning' };
        case 'accepted':
            return { text: 'Aceita — aguardando início', tone: 'info' };
        case 'going_to_pickup':
            return { text: 'A caminho do passageiro', tone: 'info' };
        case 'arrived':
            return { text: 'No local de embarque', tone: 'info' };
        case 'waiting_passenger':
            return { text: 'Aguardando passageiro', tone: 'info' };
        case 'started':
            return { text: 'Em andamento', tone: 'info' };
        case 'finished':
            return { text: 'Finalizada', tone: 'success' };
        case 'cancelled':
            return { text: 'Cancelada', tone: 'danger' };
        default:
            return { text: status || 'Desconhecido', tone: 'neutral' };
    }
}

function cancelledByLabel(cancelledBy) {
    if (cancelledBy === 'passenger') return 'Cancelada pelo passageiro';
    if (cancelledBy === 'captain') return 'Cancelada pelo motorista';
    if (cancelledBy === 'system') return 'Cancelada pelo sistema';
    return null;
}

function passengerName(ride) {
    const first = ride?.user?.fullname?.firstname;
    const last = ride?.user?.fullname?.lastname;
    const name = [ first, last ].filter(Boolean).join(' ').trim();
    return name || null;
}

const SectionTitle = ({ children }) => (
    <h3 className="text-xs font-semibold tracking-wide text-ink-400 uppercase mb-3 mt-2">
        {children}
    </h3>
);

const RideRow = ({ ride, footer = null, highlight = false }) => {
    const status = getStatusInfo(ride.status);
    const whoCancelled = ride.status === 'cancelled' ? cancelledByLabel(ride.cancelledBy) : null;

    return (
        <Card
            shadow="raised"
            padding="p-4"
            className={highlight ? 'border-2 border-brand-500 bg-brand-50/40' : ''}
        >
            <div className="flex justify-between items-start gap-3 mb-3">
                <div className="flex flex-col gap-1">
                    <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
                    {ride.source === 'driver_initiated' && (
                        <span className="text-xs font-semibold text-brand-600">Corrida presencial</span>
                    )}
                    <span className="text-xs text-ink-400">{formatDateTime(ride.createdAt)}</span>
                </div>
                <span className="text-sm font-semibold text-ink-900 shrink-0">{formatFare(ride)}</span>
            </div>

            <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 mt-1" aria-hidden="true">
                    <div className="w-2 h-2 rounded-full bg-brand-500" />
                    <div className="w-0.5 h-6 bg-line" />
                    <div className="w-2 h-2 rounded-full bg-danger-500" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs text-ink-400 mb-0.5">Origem</p>
                    <p className="text-sm font-medium text-ink-900 truncate mb-2">{shortAddress(ride.pickup)}</p>
                    <p className="text-xs text-ink-400 mb-0.5">Destino</p>
                    <p className="text-sm font-medium text-ink-900 truncate">{shortAddress(ride.destination)}</p>
                </div>
            </div>

            {passengerName(ride) && (
                <p className="text-xs text-ink-500 mt-3">
                    Passageiro: <span className="font-medium text-ink-700">{passengerName(ride)}</span>
                </p>
            )}

            {whoCancelled && (
                <p className="text-xs text-danger-600 mt-2">{whoCancelled}</p>
            )}
            {ride.status === 'cancelled' && ride.cancellationReason && (
                <p className="text-xs text-ink-500 mt-1">Motivo: {ride.cancellationReason}</p>
            )}
            {ride.status === 'cancelled' && ride.cancelledAt && (
                <p className="text-xs text-ink-400 mt-1">Em {formatDateTime(ride.cancelledAt)}</p>
            )}

            {footer}
        </Card>
    );
};

const CaptainRidesHistory = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { addToast } = useToast();
    const { socket } = useContext(SocketContext);
    const { captainRide, setCaptainRide, syncCaptainRide } = useContext(RideContext);
    const [ acceptingId, setAcceptingId ] = useState(null);

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
        queryKey: [ 'captainHistory' ],
        queryFn: async ({ pageParam = 1 }) => {
            const token = getAccessToken('captain');
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/captain-history`, {
                params: { page: pageParam, limit: 20 },
                headers: { Authorization: `Bearer ${token}` },
            });
            return response.data;
        },
        getNextPageParam: (lastPage) => (lastPage?.hasNext ? lastPage.page + 1 : undefined),
        initialPageParam: 1,
    });

    const firstPage = data?.pages?.[0];
    // RideContext primeiro: é a mesma fonte da Home (onde o atalho já aparece). O
    // bloco activeRide da API reforça após refresh; null da API NÃO pode apagar o
    // contexto (senão a aba Corridas esconde a corrida ativa que a Home mostra).
    const contextActive = captainRide && ACTIVE_STATUSES.includes(captainRide.status)
        ? captainRide
        : null;
    const apiActive = firstPage?.activeRide && ACTIVE_STATUSES.includes(firstPage.activeRide.status)
        ? firstPage.activeRide
        : null;
    const activeRide = contextActive || apiActive;
    const pendingOffers = firstPage?.pendingOffers || [];
    const historyRides = (data?.pages || []).flatMap((page) => page?.rides || []);

    const hasNowSection = Boolean(activeRide) || pendingOffers.length > 0;
    const isEmpty = !hasNowSection && historyRides.length === 0;

    useEffect(() => {
        syncCaptainRide?.();
        // Ao abrir a aba, força lista fresca — evita cache de erro/vazio de antes do
        // endpoint existir ou de uma sessão anterior.
        queryClient.invalidateQueries({ queryKey: [ 'captainHistory' ] });
    }, [ syncCaptainRide, queryClient ]);

    // Realtime: invalida a lista sem abrir outra conexão Socket.IO.
    useEffect(() => {
        if (!socket) return undefined;

        const refresh = () => {
            queryClient.invalidateQueries({ queryKey: [ 'captainHistory' ] });
            syncCaptainRide?.();
        };

        const events = [
            'new-ride',
            'ride-taken',
            'ride-confirmed',
            'ride-started',
            'ride-ended',
            'ride-finished',
            'ride-cancelled',
            'ride-cancelled-by-captain',
            'ride-status-updated',
        ];
        events.forEach((event) => socket.on(event, refresh));
        return () => {
            events.forEach((event) => socket.off(event, refresh));
        };
    }, [ socket, queryClient, syncCaptainRide ]);

    const handleReturnToRide = async (ride) => {
        if (!ride?._id) return;
        const synced = await syncCaptainRide?.();
        const target = (synced && synced._id) ? synced : ride;
        if (target.status === 'started') {
            navigate('/captain-riding', { state: { ride: target } });
            return;
        }
        // Pré-início: a Home reabre o ConfirmRidePopUp a partir do RideContext.
        navigate('/captain-home');
    };

    const handleAccept = async (ride) => {
        if (!ride?._id || acceptingId) return;
        setAcceptingId(ride._id);
        try {
            const response = await axios.post(
                `${import.meta.env.VITE_BASE_URL}/rides/${ride._id}/accept`,
                {},
                { headers: { Authorization: `Bearer ${getAccessToken('captain')}` } }
            );
            if (response.data) {
                setCaptainRide(response.data);
            }
            await queryClient.invalidateQueries({ queryKey: [ 'captainHistory' ] });
            addToast('Corrida aceita.', 'success');
            navigate('/captain-home');
        } catch (err) {
            if (err.response?.status === 409) {
                addToast('Essa corrida já foi aceita por outro motorista.', 'info');
                queryClient.invalidateQueries({ queryKey: [ 'captainHistory' ] });
            } else {
                addToast('Não foi possível aceitar a corrida. Tente novamente.', 'error');
            }
        } finally {
            setAcceptingId(null);
        }
    };

    const activeRideCard = activeRide ? (
        <RideRow
            ride={activeRide}
            highlight
            footer={(
                <div className="mt-4">
                    <p className="text-sm font-semibold text-brand-700 mb-2">
                        {activeRide.status === 'started'
                            ? 'Corrida em andamento'
                            : 'Corrida ativa'}
                    </p>
                    <Button onClick={() => handleReturnToRide(activeRide)}>
                        {activeRide.status === 'started'
                            ? 'Voltar para corrida'
                            : 'Continuar corrida'}
                    </Button>
                </div>
            )}
        />
    ) : null;

    return (
        <div className="h-screen bg-surface-alt flex flex-col pt-24">
            <PageHeader title="Corridas" className="shadow-raised" />

            <div className="flex-1 overflow-y-auto p-4 pb-28">
                <div className="flex flex-col gap-4">
                    {/* Card da ativa sempre no topo quando existir — inclusive se o
                        histórico falhar, pra o motorista conseguir voltar à navegação. */}
                    {activeRide && (
                        <>
                            <SectionTitle>Agora</SectionTitle>
                            {activeRideCard}
                        </>
                    )}

                    {isLoading && !activeRide ? (
                        <div aria-live="polite" aria-busy="true">
                            <p className="text-sm text-ink-500 mb-3">Carregando corridas...</p>
                            <RideCardSkeleton />
                            <div className="mt-4"><RideCardSkeleton /></div>
                            <div className="mt-4"><RideCardSkeleton /></div>
                        </div>
                    ) : isError && !activeRide ? (
                        <EmptyState
                            variant="error"
                            icon="ri-wifi-off-line"
                            title="Não foi possível carregar suas corridas"
                            description="Verifique sua conexão e tente novamente."
                            actionLabel={isRefetching ? 'Tentando...' : 'Tentar novamente'}
                            onAction={refetch}
                        />
                    ) : isEmpty ? (
                        <EmptyState
                            icon="ri-car-slash-line"
                            title="Nenhuma corrida encontrada"
                            description="Quando você aceitar ou finalizar corridas, elas aparecem aqui."
                        />
                    ) : (
                        <>
                            {!activeRide && pendingOffers.length > 0 && (
                                <SectionTitle>Agora</SectionTitle>
                            )}

                            {pendingOffers.map((ride) => (
                                <RideRow
                                    key={ride._id}
                                    ride={{ ...ride, status: 'requested' }}
                                    footer={(
                                        <div className="mt-4">
                                            <Button
                                                loading={acceptingId === ride._id}
                                                onClick={() => handleAccept(ride)}
                                            >
                                                Aceitar corrida
                                            </Button>
                                        </div>
                                    )}
                                />
                            ))}

                            {historyRides.length > 0 && (
                                <>
                                    <SectionTitle>Histórico</SectionTitle>
                                    {historyRides.map((ride) => (
                                        <RideRow key={ride._id} ride={ride} />
                                    ))}
                                    {hasNextPage && (
                                        <Button
                                            variant="secondary"
                                            loading={isFetchingNextPage}
                                            onClick={() => fetchNextPage()}
                                        >
                                            Carregar mais
                                        </Button>
                                    )}
                                </>
                            )}

                            {isError && activeRide && (
                                <EmptyState
                                    variant="error"
                                    icon="ri-wifi-off-line"
                                    title="Não foi possível carregar o histórico"
                                    description="A corrida ativa continua disponível acima."
                                    actionLabel={isRefetching ? 'Tentando...' : 'Tentar novamente'}
                                    onAction={refetch}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>

            <CaptainHeader />
        </div>
    );
};

export default CaptainRidesHistory;
