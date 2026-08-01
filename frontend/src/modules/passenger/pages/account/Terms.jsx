import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/shared/components/ui/PageHeader';

const Terms = () => {
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Termos de Uso" onBack={() => navigate('/profile')} />

            <div className="flex-1 overflow-y-auto p-5 bg-surface text-ink-600 leading-relaxed text-sm text-justify">
                <h3 className="font-bold text-lg mb-4 text-ink-900">1. Aceitação dos Termos</h3>
                <p className="mb-6">
                    Ao acessar e usar este aplicativo, você aceita e concorda em estar vinculado aos termos e disposições deste acordo. Além disso, ao usar os serviços específicos deste aplicativo, você estará sujeito a quaisquer diretrizes ou regras publicadas aplicáveis a esses serviços.
                </p>

                <h3 className="font-bold text-lg mb-4 text-ink-900">2. Uso do Serviço</h3>
                <p className="mb-6">
                    O aplicativo fornece uma plataforma de mobilidade que conecta motoristas a passageiros. Não nos responsabilizamos por comportamentos de terceiros, mas garantimos canais de suporte para resolução de conflitos. É proibido utilizar a plataforma para transporte de itens ilícitos.
                </p>

                <h3 className="font-bold text-lg mb-4 text-ink-900">3. Pagamentos</h3>
                <p className="mb-6">
                    As viagens devem ser pagas ao final do trajeto ou previamente via métodos de pagamento digitais caso cadastrados. Cancelamentos após 5 minutos de espera do motorista podem gerar taxas aplicáveis na próxima corrida.
                </p>

                <p className="text-xs text-ink-400 mt-10">Última atualização: 27 de Julho de 2026</p>
            </div>
        </div>
    );
};

export default Terms;
