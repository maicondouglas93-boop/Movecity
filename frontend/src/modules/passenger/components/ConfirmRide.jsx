import React from 'react'
import { vehicleImages, vehicleLabels } from '@/assets/vehicleAssets'
import Card from '@/shared/components/ui/Card'
import DetailRow from '@/shared/components/ui/DetailRow'
import Button from '@/shared/components/ui/Button'

const ConfirmRide = (props) => {
    const extractTitle = (addressStr) => {
        if (!addressStr) return '';
        if (typeof addressStr === 'object') return addressStr.address?.split(',')[0] || '';
        return addressStr.split(',')[0] || '';
    };

    const extractAddress = (addressStr) => {
        if (!addressStr) return '';
        if (typeof addressStr === 'object') return addressStr.address;
        return addressStr.replace(/\s*\(-?\d+\.\d+,\s*-?\d+\.\d+\)$/, '');
    };

    const paymentLabel = props.paymentMethod === 'pix' ? 'Pix' : props.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro';
    const paymentIconClass = props.paymentMethod === 'pix' ? 'ri-instance-line' : props.paymentMethod === 'card' ? 'ri-bank-card-fill' : 'ri-money-dollar-box-fill';
    const paymentIconColor = props.paymentMethod === 'pix' ? 'text-teal-500' : props.paymentMethod === 'card' ? 'text-blue-500' : 'text-brand-500';

    return (
        <div className='pb-6'>
            <button
                type="button"
                onClick={() => props.setConfirmRidePanel(false)}
                aria-label="Fechar"
                className='absolute right-1/2 translate-x-1/2 top-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400'
            >
                <i className="text-2xl ri-arrow-down-wide-line" aria-hidden="true"></i>
            </button>
            <h3 className='text-xl font-semibold mb-4 text-ink-900'>Confirme sua corrida</h3>

            <div className='flex flex-col gap-3'>
                {/* Veículo + opcionais */}
                <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-3'>
                        <img className='h-12 object-contain' src={vehicleImages[props.vehicleType] || vehicleImages.car} alt="" />
                        <p className='text-sm font-medium text-ink-600'>{vehicleLabels[props.vehicleType]}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => props.setOptionalsPanel(true)}
                        className='min-h-[44px] px-4 rounded-full border border-line text-sm font-medium text-ink-600 active:bg-surface-alt flex items-center gap-2'
                    >
                        <i className="ri-box-3-fill text-brand-500" aria-hidden="true"></i> Opcionais
                    </button>
                </div>

                {/* Trajeto */}
                <Card padding='p-1' className='divide-y divide-line'>
                    <DetailRow
                        icon="ri-map-pin-user-fill"
                        title={extractTitle(props.pickup)}
                        subtitle={extractAddress(props.pickup)}
                        className='px-3'
                    />
                    <DetailRow
                        icon="ri-map-pin-2-fill"
                        iconColor="text-danger-500"
                        title={extractTitle(props.destination)}
                        subtitle={extractAddress(props.destination)}
                        className='px-3'
                    />
                </Card>

                {/* Pagamento + preço */}
                <Card padding='p-1' className='divide-y divide-line'>
                    <DetailRow
                        icon={paymentIconClass}
                        iconColor={paymentIconColor}
                        title={paymentLabel}
                        subtitle="Forma de pagamento"
                        onClick={() => props.setPaymentPanel(true)}
                        trailing={<i className="ri-arrow-right-s-line text-xl text-ink-400" aria-hidden="true"></i>}
                        className='px-3'
                    />
                    <DetailRow
                        icon="ri-currency-line"
                        title={props.fare?.fare?.[props.vehicleType] ? `R$${props.fare.fare[props.vehicleType]}` : ''}
                        subtitle={props.fare?.showAsEstimate !== false ? 'Valor estimado' : 'Valor da corrida'}
                        className='px-3'
                    />
                </Card>

                {/* Bloco H (2026-08-02): cupom é opcional — o código só é enviado junto
                    com a criação da corrida (sem endpoint de validação separado); um
                    código inválido não trava a confirmação, só não desconta nada. */}
                <div className='flex items-center gap-2 border border-line rounded-panel px-3 py-2.5'>
                    <i className="ri-coupon-3-line text-brand-500 text-lg" aria-hidden="true"></i>
                    <input
                        type="text"
                        value={props.promoCode}
                        onChange={(e) => props.setPromoCode(e.target.value.toUpperCase())}
                        placeholder="Cupom de desconto (opcional)"
                        className='flex-1 text-sm text-ink-900 placeholder:text-ink-400 outline-none bg-transparent min-w-0'
                    />
                </div>
            </div>

            <Button
                onClick={() => {
                    props.setVehicleFound(true)
                    props.setConfirmRidePanel(false)
                    props.createRide()
                }}
                className='mt-4'
            >
                Confirmar Corrida
            </Button>
        </div>
    )
}

export default ConfirmRide
