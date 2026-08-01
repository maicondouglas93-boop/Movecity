import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/shared/components/ui/PageHeader';

const Privacy = () => {
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Política de Privacidade" onBack={() => navigate('/profile')} />

            <div className="flex-1 overflow-y-auto p-5 bg-surface text-ink-600 leading-relaxed text-sm text-justify">
                <h3 className="font-bold text-lg mb-4 text-ink-900">1. Coleta de Dados</h3>
                <p className="mb-6">
                    Coletamos dados necessários para o funcionamento do app, incluindo localização em tempo real (GPS), dados de contato (nome, telefone, email) e informações do aparelho para segurança e melhoria do serviço.
                </p>

                <h3 className="font-bold text-lg mb-4 text-ink-900">2. Uso da Localização</h3>
                <p className="mb-6">
                    Sua localização é rastreada durante a corrida para sua segurança e para calcular a rota e preço corretos. Quando o aplicativo está em segundo plano e você não está em viagem, a localização não é consumida.
                </p>

                <h3 className="font-bold text-lg mb-4 text-ink-900">3. Compartilhamento</h3>
                <p className="mb-6">
                    O motorista recebe apenas o seu primeiro nome e a localização de embarque/desembarque. Seus dados completos e número de telefone são mascarados/protegidos e não são repassados a terceiros sem seu consentimento.
                </p>

                <p className="text-xs text-ink-400 mt-10">Última atualização: 27 de Julho de 2026</p>
            </div>
        </div>
    );
};

export default Privacy;
