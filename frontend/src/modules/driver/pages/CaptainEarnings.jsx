import React, { useContext, useState } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import CaptainHeader from '@/modules/driver/components/CaptainHeader';
import { CaptainDataContext } from '@/contexts/CaptainContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import { RideCardSkeleton } from '@/shared/components/ui/Skeleton';

const RANGES = [
    { value: 'day', label: 'Hoje' },
    { value: 'week', label: 'Semana' },
    { value: 'month', label: 'Mês' },
];

const CaptainEarnings = () => {
    const { captain } = useContext(CaptainDataContext);
    // Auditoria de UX do motorista (2026-08-02, Etapa 8): a tela só mostrava o total
    // acumulado vitalício (captain.earnings), sem nenhum recorte temporal nem detalhe
    // por corrida — "Quanto ganhei hoje/nesta semana/neste mês?" não tinha resposta.
    const [range, setRange] = useState('day');

    const { data, isLoading, isError, refetch, isRefetching } = useQuery({
        queryKey: ['captainEarnings', range],
        queryFn: async () => {
            const token = localStorage.getItem('captain-token');
            const res = await axios.get(`${import.meta.env.VITE_BASE_URL}/captains/earnings?range=${range}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.data;
        }
    });

    return (
        <div className="h-screen bg-surface-alt flex flex-col pt-24">
            <PageHeader title="Ganhos" className="shadow-raised" />

            <div className="flex-1 overflow-y-auto p-4 pb-6">
                <div className="bg-ink-900 text-white rounded-panel p-6 shadow-floating mb-6 text-center">
                    <p className="text-white/70 text-sm mb-1">Ganhos Totais</p>
                    <h2 className="text-4xl font-bold mb-2">R$ {captain?.earnings?.toFixed(2) || '0.00'}</h2>
                    <p className="text-white/50 text-xs">Total acumulado na plataforma</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    <Card shadow="raised" padding="p-5" className="text-center">
                        <i className="ri-route-line text-2xl text-blue-500 mb-2 block"></i>
                        <h3 className="text-xl font-bold text-ink-900">{captain?.totalRides || 0}</h3>
                        <p className="text-xs text-ink-600">Corridas Concluídas</p>
                    </Card>
                    <Card shadow="raised" padding="p-5" className="text-center">
                        <i className="ri-star-fill text-2xl text-yellow-500 mb-2 block"></i>
                        <h3 className="text-xl font-bold text-ink-900">{captain?.rating?.toFixed(1) || '5.0'}</h3>
                        <p className="text-xs text-ink-600">Avaliação Média</p>
                    </Card>
                </div>

                {/* Recorte temporal */}
                <div className="flex bg-surface-alt rounded-panel p-1 mb-4 gap-1">
                    {RANGES.map(r => (
                        <button
                            key={r.value}
                            type="button"
                            onClick={() => setRange(r.value)}
                            className={`flex-1 py-2 rounded-panel text-sm font-semibold transition-colors ${
                                range === r.value ? 'bg-surface text-ink-900 shadow-raised' : 'text-ink-600'
                            }`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>

                <Card shadow="raised" padding="p-5" className="mb-4">
                    <p className="text-xs text-ink-600 font-bold uppercase tracking-wider mb-1">
                        Ganhos {RANGES.find(r => r.value === range)?.label.toLowerCase()}
                    </p>
                    <h2 className="text-3xl font-black text-ink-900 tracking-tight">
                        {isLoading ? '...' : `R$ ${data?.totalEarnings?.toFixed(2) || '0.00'}`}
                    </h2>
                    <p className="text-xs text-ink-600 mt-1">
                        {isLoading ? '...' : `${data?.totalRides || 0} corrida${data?.totalRides === 1 ? '' : 's'} • R$ ${data?.totalCommission?.toFixed(2) || '0.00'} em comissão`}
                    </p>
                </Card>

                <h3 className="text-sm font-bold text-ink-900 mb-3">Corridas do período</h3>
                {isLoading ? (
                    <div className="flex flex-col gap-3 mb-6">
                        <RideCardSkeleton />
                        <RideCardSkeleton />
                    </div>
                ) : isError ? (
                    <div className="mb-6">
                        <EmptyState
                            variant="error"
                            icon="ri-wifi-off-line"
                            title="Não foi possível carregar seus ganhos"
                            description="Verifique sua conexão e tente novamente."
                            actionLabel={isRefetching ? 'Tentando...' : 'Tentar de novo'}
                            onAction={refetch}
                        />
                    </div>
                ) : !data?.rides?.length ? (
                    <div className="mb-6">
                        <EmptyState
                            icon="ri-car-line"
                            title="Nenhuma corrida no período"
                            description="Corridas finalizadas neste recorte aparecem aqui, com o valor líquido de cada uma."
                        />
                    </div>
                ) : (
                    <div className="flex flex-col gap-3 mb-6">
                        {data.rides.map(ride => (
                            <Card key={ride.rideId} shadow="raised" padding="p-4">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-ink-900 truncate">{ride.pickup?.split(',')[0]}</p>
                                        <p className="text-xs text-ink-600 truncate">→ {ride.destination?.split(',')[0]}</p>
                                    </div>
                                    <span className="text-xs text-ink-600 flex-shrink-0 ml-2">
                                        {new Date(ride.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-xs border-t border-line pt-2 mt-1">
                                    <span className="text-ink-600">Bruto R$ {ride.grossFare?.toFixed(2)} · Comissão R$ {ride.commission?.toFixed(2)}</span>
                                    <span className="font-bold text-brand-600">R$ {ride.netEarnings?.toFixed(2)}</span>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}

                <Card shadow="raised" padding="p-5">
                    <h3 className="font-semibold text-ink-900 mb-4">Desempenho</h3>
                    <div className="space-y-4">
                        {/* Auditoria de UX do motorista (2026-08-02): "Taxa de Aceitação" foi
                            removida daqui — o backend nunca calcula esse número (fica sempre
                            no valor padrão do schema, 100%, para todo motorista, sempre).
                            Mostrar isso seria fabricar um dado, não exibir um dado real. O
                            cálculo de verdade fica para uma etapa futura (fora deste escopo). */}
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-ink-600">Taxa de Cancelamento</span>
                                <span className="font-medium text-danger-500">{captain?.cancellationRate || 0}%</span>
                            </div>
                            <div className="w-full bg-surface-alt rounded-full h-2">
                                <div className="bg-danger-500 h-2 rounded-full" style={{ width: `${captain?.cancellationRate || 0}%` }}></div>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            <CaptainHeader />
        </div>
    );
};

export default CaptainEarnings;
