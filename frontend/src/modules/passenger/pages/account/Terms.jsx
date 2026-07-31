import React from 'react';
import { useNavigate } from 'react-router-dom';

const Terms = () => {
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10">
                <i onClick={() => navigate('/profile')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"></i>
                <h2 className="text-xl font-semibold flex-1 text-gray-800">Termos de Uso</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-white text-gray-700 leading-relaxed text-sm text-justify">
                <h3 className="font-bold text-lg mb-4 text-black">1. Aceitação dos Termos</h3>
                <p className="mb-6">
                    Ao acessar e usar este aplicativo, você aceita e concorda em estar vinculado aos termos e disposições deste acordo. Além disso, ao usar os serviços específicos deste aplicativo, você estará sujeito a quaisquer diretrizes ou regras publicadas aplicáveis a esses serviços.
                </p>

                <h3 className="font-bold text-lg mb-4 text-black">2. Uso do Serviço</h3>
                <p className="mb-6">
                    O aplicativo fornece uma plataforma de mobilidade que conecta motoristas a passageiros. Não nos responsabilizamos por comportamentos de terceiros, mas garantimos canais de suporte para resolução de conflitos. É proibido utilizar a plataforma para transporte de itens ilícitos.
                </p>

                <h3 className="font-bold text-lg mb-4 text-black">3. Pagamentos</h3>
                <p className="mb-6">
                    As viagens devem ser pagas ao final do trajeto ou previamente via métodos de pagamento digitais caso cadastrados. Cancelamentos após 5 minutos de espera do motorista podem gerar taxas aplicáveis na próxima corrida.
                </p>

                <p className="text-xs text-gray-400 mt-10">Última atualização: 27 de Julho de 2026</p>
            </div>
        </div>
    );
};

export default Terms;
