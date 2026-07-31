import React, { useState } from 'react';

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
            <h5 className='p-1 text-center w-[93%] absolute top-0' onClick={() => {
                props.setOptionalsPanel(false)
            }}><i className="text-3xl text-gray-300 ri-arrow-down-wide-line"></i></h5>
            
            <div className='flex items-center gap-3 mb-5'>
                <i className="ri-arrow-left-line text-xl cursor-pointer" onClick={() => props.setOptionalsPanel(false)}></i>
                <h3 className='text-xl font-semibold text-gray-800'>Opcionais</h3>
            </div>

            <div className='flex flex-col gap-4'>
                <div className='flex items-center justify-between border-b border-gray-100 pb-3'>
                    <label htmlFor="porta_malas" className='text-base text-gray-800 font-medium'>Porta-malas grande</label>
                    <input type="checkbox" id="porta_malas" className='w-5 h-5 accent-green-600' 
                        checked={selectedOptionals.includes('porta_malas')}
                        onChange={() => toggleOptional('porta_malas')} />
                </div>
                
                <div className='flex items-center justify-between border-b border-gray-100 pb-3'>
                    <label htmlFor="aceita_animais" className='text-base text-gray-800 font-medium'>Aceita animais</label>
                    <input type="checkbox" id="aceita_animais" className='w-5 h-5 accent-green-600'
                        checked={selectedOptionals.includes('aceita_animais')}
                        onChange={() => toggleOptional('aceita_animais')} />
                </div>
                
                <div className='flex items-center justify-between border-b border-gray-100 pb-3'>
                    <label htmlFor="motorista_mulher" className='text-base text-gray-800 font-medium'>Motorista mulher</label>
                    <input type="checkbox" id="motorista_mulher" className='w-5 h-5 accent-green-600'
                        checked={requestFemaleDriver}
                        onChange={(e) => setRequestFemaleDriver(e.target.checked)} />
                </div>
                
                <div className='flex items-center justify-between border-b border-gray-100 pb-3'>
                    <label htmlFor="aceita_encomendas" className='text-base text-gray-800 font-medium'>Aceita encomendas</label>
                    <input type="checkbox" id="aceita_encomendas" className='w-5 h-5 accent-green-600'
                        checked={selectedOptionals.includes('aceita_encomendas')}
                        onChange={() => toggleOptional('aceita_encomendas')} />
                </div>
                
                <div className='flex items-center justify-between border-b border-gray-100 pb-3'>
                    <label htmlFor="adaptado_cadeirante" className='text-base text-gray-800 font-medium'>Adaptado para cadeirante</label>
                    <input type="checkbox" id="adaptado_cadeirante" className='w-5 h-5 accent-green-600'
                        checked={selectedOptionals.includes('adaptado_cadeirante')}
                        onChange={() => toggleOptional('adaptado_cadeirante')} />
                </div>
                
                <div className='flex items-center justify-between border-b border-gray-100 pb-3'>
                    <label htmlFor="disposicao_passageiro" className='text-base text-gray-800 font-medium'>Ficar à disposição do passageiro</label>
                    <input type="checkbox" id="disposicao_passageiro" className='w-5 h-5 accent-green-600'
                        checked={selectedOptionals.includes('disposicao_passageiro')}
                        onChange={() => toggleOptional('disposicao_passageiro')} />
                </div>

                <div className='mt-2'>
                    <label className='text-base font-semibold text-gray-800 block mb-2'>Observação</label>
                    <textarea 
                        className='w-full border border-gray-300 rounded-xl p-3 resize-none outline-none focus:border-green-500'
                        rows="3"
                        placeholder='O que seu motorista precisa saber?'
                        value={observation}
                        onChange={(e) => setObservation(e.target.value)}
                    ></textarea>
                    <p className='text-xs text-gray-500 mt-1'>O motorista verá a observação antes de aceitar a corrida</p>
                </div>
            </div>

            <button 
                onClick={handleConfirm}
                className='w-full mt-6 bg-black hover:bg-gray-800 text-white font-bold p-4 rounded-xl text-lg transition-colors'>
                Pronto
            </button>
        </div>
    );
};

export default OptionalsPanel;
