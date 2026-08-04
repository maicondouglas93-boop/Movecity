import React from 'react';

const METHODS = [
    { id: 'pix', label: 'Pix', icon: 'ri-instance-line', iconColor: 'text-teal-500' },
    { id: 'cash', label: 'Dinheiro', icon: 'ri-money-dollar-box-fill', iconColor: 'text-brand-500' },
];

const PaymentOptionsPanel = (props) => {
    return (
        <div className='pb-6 bg-surface'>
            <button
                type="button"
                onClick={() => props.setPaymentPanel(false)}
                aria-label="Fechar"
                className='absolute right-1/2 translate-x-1/2 top-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400'
            >
                <i className="text-2xl ri-arrow-down-wide-line" aria-hidden="true"></i>
            </button>

            <div className='flex items-center gap-3 mb-5'>
                <button
                    type="button"
                    onClick={() => props.setPaymentPanel(false)}
                    aria-label="Voltar"
                    className='min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-ink-900'
                >
                    <i className="ri-arrow-left-line text-xl" aria-hidden="true"></i>
                </button>
                <h3 className='text-xl font-semibold text-ink-900'>Opções de pagamento</h3>
            </div>

            <div className='bg-surface-alt rounded-panel p-4 mb-4 flex items-center justify-between'>
                <div>
                    <p className='text-sm text-ink-400 mb-1'>Saldo da carteira</p>
                    <h2 className='text-3xl font-bold text-ink-900'>R$ {(props.walletBalance || 0).toFixed(2).replace('.', ',')}</h2>
                </div>
            </div>

            <label className='flex items-center justify-between py-2 border-b border-line mb-4 cursor-pointer'>
                <span className='text-base text-ink-900'>Usar saldo disponível em viagens</span>
                <div className='relative inline-block w-12 h-6 align-middle select-none'>
                    <input
                        type="checkbox"
                        checked={props.useWalletBalance}
                        onChange={(e) => props.setUseWalletBalance(e.target.checked)}
                        className={`absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer transition-transform duration-200 ${props.useWalletBalance ? 'translate-x-6 border-brand-500' : 'translate-x-0 border-line'}`}
                    />
                    <span className={`block overflow-hidden h-6 rounded-full transition-colors duration-200 ${props.useWalletBalance ? 'bg-brand-500' : 'bg-line'}`}></span>
                </div>
            </label>

            <h4 className='text-base font-semibold text-ink-900 mb-3'>Forma de pagamento</h4>

            <div className='flex flex-col gap-2'>
                {METHODS.map((method) => {
                    const isSelected = props.paymentMethod === method.id
                    return (
                        <button
                            key={method.id}
                            type="button"
                            onClick={() => props.setPaymentMethod(method.id)}
                            aria-pressed={isSelected}
                            className={`flex items-center justify-between p-4 rounded-panel border transition-colors ${isSelected ? 'border-brand-500 bg-brand-50' : 'border-line'}`}
                        >
                            <div className='flex items-center gap-3'>
                                <i className={`${method.icon} ${method.iconColor} text-2xl`} aria-hidden="true"></i>
                                <span className='text-base font-medium text-ink-900'>{method.label}</span>
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-brand-500' : 'border-line'}`}>
                                {isSelected && <div className='w-2.5 h-2.5 rounded-full bg-brand-500'></div>}
                            </div>
                        </button>
                    )
                })}
            </div>
            {/* "Adicionar cartão" e "Cupom" removidos — eram linhas sem nenhum onClick,
                puramente decorativas (pagamento por cartão está fora do escopo atual —
                ver decisão C2 da auditoria de integração; cupons ainda não têm fluxo de
                aplicação real). Mesmo critério já usado pra esconder itens sem backend
                no menu de conta (Sprint 4 da auditoria de integração). */}
        </div>
    );
};

export default PaymentOptionsPanel;
