import React from 'react'
import { vehicleImages, vehicleLabels } from '@/shared/assets/vehicleAssets'
import Card from '@/shared/components/ui/Card'
import DetailRow from '@/shared/components/ui/DetailRow'
import Button from '@/shared/components/ui/Button'

const ConfirmRide = (props) => {
    const extractTitle = (addressStr) => {
        if (!addressStr) return '';
        if (typeof addressStr === 'object') return addressStr.address?.split(',')[0] || '';
        return addressStr.split(',')[0] || '';
    };

    const paymentLabel = props.paymentMethod === 'pix' ? 'Pix' : props.paymentMethod === 'card' ? 'Cartão' : 'Dinheiro';
    const paymentIconClass = props.paymentMethod === 'pix' ? 'ri-qr-code-line' : props.paymentMethod === 'card' ? 'ri-bank-card-fill' : 'ri-money-dollar-box-fill';
    const paymentIconColor = props.paymentMethod === 'pix' ? 'text-teal-500' : props.paymentMethod === 'card' ? 'text-blue-500' : 'text-brand-500'
    const fareValue = props.fare?.fare?.[props.vehicleType]

    return (
        <div className='pb-2'>
            <div className='flex items-center justify-between gap-2 mb-3'>
                <div className='flex items-center gap-2.5 min-w-0'>
                    <img
                        className='h-10 w-14 object-contain flex-shrink-0'
                        src={vehicleImages[props.vehicleType] || vehicleImages.car}
                        alt=""
                        width="1024"
                        height="1024"
                        loading="lazy"
                    />
                    <div className='min-w-0'>
                        <h3 className='text-base font-semibold text-ink-900 truncate'>Confirmar corrida</h3>
                        <p className='text-xs text-ink-500 truncate'>{vehicleLabels[props.vehicleType]}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => props.setOptionalsPanel(true)}
                    className='min-h-[40px] px-3 rounded-full border border-line text-xs font-medium text-ink-600 active:bg-surface-alt flex items-center gap-1.5 flex-shrink-0'
                >
                    <i className="ri-box-3-fill text-brand-500" aria-hidden="true"></i> Opcionais
                </button>
            </div>

            <div className='flex flex-col gap-2'>
                <Card padding='p-0.5' className='divide-y divide-line'>
                    <DetailRow
                        compact
                        icon="ri-map-pin-user-fill"
                        title={extractTitle(props.pickup)}
                        className='px-2'
                    />
                    <DetailRow
                        compact
                        icon="ri-map-pin-2-fill"
                        iconColor="text-danger-500"
                        title={extractTitle(props.destination)}
                        className='px-2'
                    />
                </Card>

                <Card padding='p-0.5' className='divide-y divide-line'>
                    <DetailRow
                        compact
                        icon={paymentIconClass}
                        iconColor={paymentIconColor}
                        title={paymentLabel}
                        subtitle="Pagamento"
                        onClick={() => props.setPaymentPanel(true)}
                        trailing={<i className="ri-arrow-right-s-line text-lg text-ink-400" aria-hidden="true"></i>}
                        className='px-2'
                    />
                    <DetailRow
                        compact
                        icon="ri-currency-line"
                        title={fareValue != null ? `R$${fareValue}` : ''}
                        subtitle={props.fare?.showAsEstimate !== false ? 'Estimativa' : 'Valor'}
                        className='px-2'
                    />
                </Card>

                {/* Bloco H (2026-08-02): cupom é opcional — o código só é enviado junto
                    com a criação da corrida (sem endpoint de validação separado); um
                    código inválido não trava a confirmação, só não desconta nada. */}
                <div className='flex items-center gap-2 border border-line rounded-panel px-3 py-2'>
                    <i className="ri-coupon-3-line text-brand-500 text-base" aria-hidden="true"></i>
                    <input
                        type="text"
                        value={props.promoCode}
                        onChange={(e) => props.setPromoCode(e.target.value.toUpperCase())}
                        placeholder="Cupom (opcional)"
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
                className='mt-3 !min-h-[44px] !text-sm'
            >
                Confirmar corrida
            </Button>
        </div>
    )
}

export default ConfirmRide
