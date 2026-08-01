import React from 'react';

const PaymentOptionsPanel = (props) => {

    const handleMethodSelect = (method) => {
        props.setPaymentMethod(method);
    };

    return (
        <div className='pb-6 bg-white'>
            <h5 className='p-1 text-center w-[93%] absolute top-0' onClick={() => {
                props.setPaymentPanel(false)
            }}><i className="text-3xl text-gray-300 ri-arrow-down-wide-line"></i></h5>
            
            <div className='flex items-center gap-3 mb-6 mt-2'>
                <i className="ri-arrow-left-line text-xl cursor-pointer" onClick={() => props.setPaymentPanel(false)}></i>
                <h3 className='text-xl font-semibold text-gray-800'>Opções de pagamento</h3>
            </div>

            <div className='bg-gray-100 rounded-xl p-4 mb-4 flex items-center justify-between'>
                <div>
                    <p className='text-sm text-gray-500 mb-1'>Saldo da carteira</p>
                    <h2 className='text-3xl font-bold text-gray-700'>R$ {(props.walletBalance || 0).toFixed(2).replace('.', ',')}</h2>
                </div>
                <i className="ri-arrow-right-s-line text-2xl text-gray-400"></i>
            </div>

            <div className='flex items-center justify-between py-2 border-b border-gray-100 mb-4'>
                <p className='text-base text-gray-700'>Usar saldo disponível em viagens</p>
                <div className='relative inline-block w-12 mr-2 align-middle select-none transition duration-200 ease-in'>
                    <input type="checkbox" name="toggle" id="toggle" 
                        checked={props.useWalletBalance}
                        onChange={(e) => props.setUseWalletBalance(e.target.checked)}
                        className={`toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer transition-transform duration-200 ${props.useWalletBalance ? 'translate-x-6 border-green-500' : 'translate-x-0 border-gray-300'}`}/>
                    <label htmlFor="toggle" className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer transition-colors duration-200 ${props.useWalletBalance ? 'bg-green-500' : 'bg-gray-300'}`}></label>
                </div>
            </div>

            <h4 className='text-base font-semibold text-gray-700 mb-3'>Forma de pagamento</h4>

            <div className='flex flex-col'>
                <div 
                    onClick={() => handleMethodSelect('pix')}
                    className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${props.paymentMethod === 'pix' ? 'bg-gray-100 rounded-lg' : ''}`}>
                    <div className='flex items-center gap-3'>
                        <i className="ri-instance-line text-teal-500 text-2xl"></i>
                        <span className='text-base font-medium text-gray-800'>Pix</span>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${props.paymentMethod === 'pix' ? 'border-black' : 'border-gray-400'}`}>
                        {props.paymentMethod === 'pix' && <div className='w-2.5 h-2.5 rounded-full bg-black'></div>}
                    </div>
                </div>

                <div 
                    onClick={() => handleMethodSelect('cash')}
                    className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${props.paymentMethod === 'cash' ? 'bg-gray-100 rounded-lg' : ''}`}>
                    <div className='flex items-center gap-3'>
                        <i className="ri-money-dollar-box-fill text-green-500 text-2xl"></i>
                        <span className='text-base font-medium text-gray-800'>Dinheiro</span>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${props.paymentMethod === 'cash' ? 'border-black' : 'border-gray-400'}`}>
                        {props.paymentMethod === 'cash' && <div className='w-2.5 h-2.5 rounded-full bg-black'></div>}
                    </div>
                </div>
            </div>

            <div className='border-t border-gray-100 mt-2'>
                <div className='p-4 text-base font-medium text-gray-800 cursor-pointer'>
                    Adicionar cartão de crédito
                </div>
            </div>

            <h4 className='text-base font-semibold text-gray-700 mt-4 mb-2'>Cupom</h4>
            <div className='border-t border-gray-100'>
                <div className='p-4 text-base font-medium text-gray-800 flex justify-between items-center cursor-pointer'>
                    Adicionar cupom
                    <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                </div>
            </div>
            
        </div>
    );
};

export default PaymentOptionsPanel;
