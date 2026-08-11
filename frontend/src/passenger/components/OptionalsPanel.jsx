import React, { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import { formatCurrencyBRL } from '@/shared/utils/formatters';

const OPTIONS = [
    { id: 'porta_malas', label: 'Porta-malas grande' },
    { id: 'aceita_animais', label: 'Aceita animais' },
    { id: 'aceita_encomendas', label: 'Aceita encomendas' },
    { id: 'adaptado_cadeirante', label: 'Adaptado para cadeirante' },
    { id: 'disposicao_passageiro', label: 'Ficar à disposição do passageiro' },
];

const OptionalsPanel = (props) => {
    const [selectedOptionals, setSelectedOptionals] = useState([]);
    const [observation, setObservation] = useState('');
    const [requestFemaleDriver, setRequestFemaleDriver] = useState(false);

    const toggleOptional = (type) => {
        if (selectedOptionals.includes(type)) {
            setSelectedOptionals(selectedOptionals.filter(t => t !== type));
        } else {
            setSelectedOptionals([...selectedOptionals, type]);
        }
    };

    const handleConfirm = () => {
        props.setOptionals(selectedOptionals);
        props.setObservation(observation);
        props.setRequestFemaleDriver(requestFemaleDriver);
        props.setOptionalsPanel(false);
    };

    return (
        <div className='pb-6'>
            <button
                type="button"
                onClick={() => props.setOptionalsPanel(false)}
                aria-label="Fechar"
                className='absolute right-1/2 translate-x-1/2 top-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400'
            >
                <i className="text-2xl ri-arrow-down-wide-line" aria-hidden="true"></i>
            </button>

            <div className='flex items-center gap-3 mb-4'>
                <button
                    type="button"
                    onClick={() => props.setOptionalsPanel(false)}
                    aria-label="Voltar"
                    className='min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-ink-900'
                >
                    <i className="ri-arrow-left-line text-xl" aria-hidden="true"></i>
                </button>
                <h3 className='text-xl font-semibold text-ink-900'>Opcionais</h3>
            </div>

            <div className='flex flex-col'>
                {OPTIONS.map((opt) => {
                    const price = Number(props.optionalPrices?.[opt.id]);
                    const priceLabel = Number.isFinite(price)
                        ? (price > 0 ? `+ ${formatCurrencyBRL(price)}` : 'Grátis')
                        : null;
                    return (
                    <label
                        key={opt.id}
                        htmlFor={opt.id}
                        className='flex items-center justify-between py-3 border-b border-line cursor-pointer gap-3'
                    >
                        <span className='text-base text-ink-900 font-medium flex-1'>
                            {opt.label}
                            {priceLabel && (
                                <span className='block text-sm font-normal text-ink-400'>{priceLabel}</span>
                            )}
                        </span>
                        <input
                            type="checkbox"
                            id={opt.id}
                            className='w-5 h-5 accent-brand-600 shrink-0'
                            checked={selectedOptionals.includes(opt.id)}
                            onChange={() => toggleOptional(opt.id)}
                        />
                    </label>
                    );
                })}

                <label htmlFor="motorista_mulher" className='flex items-center justify-between py-3 border-b border-line cursor-pointer'>
                    <span className='text-base text-ink-900 font-medium'>Motorista mulher</span>
                    <input
                        type="checkbox"
                        id="motorista_mulher"
                        className='w-5 h-5 accent-brand-600'
                        checked={requestFemaleDriver}
                        onChange={(e) => setRequestFemaleDriver(e.target.checked)}
                    />
                </label>

                <div className='mt-3'>
                    <label htmlFor="observation" className='text-base font-semibold text-ink-900 block mb-2'>Observação</label>
                    <textarea
                        id="observation"
                        className='w-full border border-line rounded-panel p-3 resize-none outline-none focus:border-brand-500 text-ink-900 placeholder-ink-400'
                        rows="3"
                        placeholder='O que seu motorista precisa saber?'
                        value={observation}
                        onChange={(e) => setObservation(e.target.value)}
                    ></textarea>
                    <p className='text-xs text-ink-400 mt-1'>O motorista verá a observação antes de aceitar a corrida</p>
                </div>
            </div>

            {/* Era um botão preto avulso, sem nenhuma outra tela do app usando essa cor —
                trocado pro CTA primário padrão, consistente com o resto do fluxo. */}
            <Button onClick={handleConfirm} className='mt-5'>
                Pronto
            </Button>
        </div>
    );
};

export default OptionalsPanel;
