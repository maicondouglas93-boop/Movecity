import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/shared/components/ui/PageHeader';
import DetailRow from '@/shared/components/ui/DetailRow';

const Help = () => {
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Central de Ajuda" onBack={() => navigate('/account')} />

            <div className="flex-1 overflow-y-auto">
                <div className="p-5 bg-ink-900 text-white mb-2">
                    <h1 className="text-2xl font-bold mb-2">Como podemos ajudar?</h1>
                    <p className="text-sm text-white/70">Selecione o assunto abaixo para encontrar a solução mais rápida.</p>
                </div>

                <div className="bg-surface mb-2 divide-y divide-line">
                    <DetailRow
                        icon="ri-alert-fill"
                        iconColor="text-amber-500"
                        title="Problemas com uma corrida"
                        subtitle="Valores incorretos, rota ruim, acidentes."
                        className="px-4"
                    />
                    <DetailRow
                        icon="ri-search-eye-fill"
                        iconColor="text-blue-500"
                        title="Objeto perdido"
                        subtitle="Esqueci algo no carro do motorista."
                        className="px-4"
                    />
                    <DetailRow
                        icon="ri-bank-card-fill"
                        title="Problemas no Pagamento"
                        subtitle="Cobrança duplicada, cartão recusado."
                        className="px-4"
                    />
                </div>

                <div className="p-4">
                    <h3 className="font-semibold text-ink-600 mb-3 px-1">Suporte Direto</h3>
                    <div className="bg-surface rounded-panel border border-line shadow-raised overflow-hidden divide-y divide-line">
                        <DetailRow
                            icon="ri-customer-service-2-fill"
                            iconColor="text-ink-600"
                            title="Falar com o suporte (Chat)"
                            className="px-4"
                        />
                        <DetailRow
                            icon="ri-ticket-fill"
                            iconColor="text-ink-600"
                            title="Abrir novo chamado"
                            className="px-4"
                        />
                        <DetailRow
                            icon="ri-history-line"
                            iconColor="text-ink-600"
                            title="Histórico de chamados"
                            className="px-4"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Help;
