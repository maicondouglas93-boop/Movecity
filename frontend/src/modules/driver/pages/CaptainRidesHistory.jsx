import React from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import CaptainHeader from '@/modules/driver/components/CaptainHeader';
import PageHeader from '@/shared/components/ui/PageHeader';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import { RideCardSkeleton } from '@/shared/components/ui/Skeleton';
import { getAccessToken } from '@/services/session';

const CaptainRidesHistory = () => {
    // Auditoria de UX do motorista (2026-08-02, §2.13): o `.catch(() => null)` que
    // existia aqui escondia qualquer erro de rede/servidor do react-query, convertendo
    // silenciosamente em "sem corridas" — um motorista com 300 corridas via a mesma
    // tela de um motorista novo. Removido: agora `isError` reflete a falha de verdade.
    const { data: rides = [], isLoading: loading, isError, refetch, isRefetching } = useQuery({
        queryKey: ['captainHistory'],
        queryFn: async () => {
            const token = getAccessToken('captain');
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/captain-history`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return response?.data?.rides || [];
        }
    });

    return (
        <div className="h-screen bg-surface-alt flex flex-col pt-24">
            <PageHeader title="Histórico de Corridas" className="shadow-raised" />

            <div className="flex-1 overflow-y-auto p-4 pb-6">
                {loading ? (
                    <div className="flex flex-col gap-4">
                        <RideCardSkeleton />
                        <RideCardSkeleton />
                        <RideCardSkeleton />
                    </div>
                ) : isError ? (
                    <EmptyState
                        variant="error"
                        icon="ri-wifi-off-line"
                        title="Não foi possível carregar seu histórico"
                        description="Verifique sua conexão e tente novamente."
                        actionLabel={isRefetching ? 'Tentando...' : 'Tentar de novo'}
                        onAction={refetch}
                    />
                ) : rides.length === 0 ? (
                    <EmptyState
                        icon="ri-car-slash-line"
                        title="Nenhuma corrida ainda"
                        description="Você ainda não realizou nenhuma corrida."
                    />
                ) : (
                    <div className="flex flex-col gap-4">
                        {rides.map(ride => (
                            <Card key={ride._id} shadow="raised" padding="p-4">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-xs font-medium bg-surface-alt text-ink-600 px-2 py-1 rounded-md">
                                        {new Date(ride.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                                    </span>
                                    <span className={`text-sm font-semibold ${ride.status === 'completed' || ride.status === 'finished' ? 'text-brand-600' : 'text-amber-600'}`}>
                                        R$ {ride.fare}
                                    </span>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="flex flex-col items-center gap-1 mt-1">
                                        <div className="w-2 h-2 rounded-full bg-brand-500"></div>
                                        <div className="w-0.5 h-6 bg-line"></div>
                                        <div className="w-2 h-2 rounded-full bg-danger-500"></div>
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-ink-900 truncate mb-2">{ride.pickup.split(',')[0]}</p>
                                        <p className="text-sm font-medium text-ink-900 truncate">{ride.destination.split(',')[0]}</p>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            <CaptainHeader />
        </div>
    );
}

export default CaptainRidesHistory;
