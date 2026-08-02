import React, { useContext } from 'react';
import CaptainHeader from '@/modules/driver/components/CaptainHeader';
import { CaptainDataContext } from '@/contexts/CaptainContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import Card from '@/shared/components/ui/Card';

const CaptainEarnings = () => {
    const { captain } = useContext(CaptainDataContext);

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
