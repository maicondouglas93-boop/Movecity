import React from 'react'
import { vehicleImages, vehicleLabels } from '@/shared/assets/vehicleAssets'
import Card from '@/shared/components/ui/Card'
import Button from '@/shared/components/ui/Button'
import RouteCard from '@/shared/components/ui/RouteCard'
import { formatCurrencyBRL, formatDistanceLabel, formatDurationLabel, paymentMethodLabel } from '@/shared/utils/formatters'

const ConfirmRide = (props) => {
    const extractTitle = (addressStr) => {
        if (!addressStr) return '';
        if (typeof addressStr === 'object') return addressStr.address?.split(',')[0] || '';
        return addressStr.split(',')[0] || '';
    };

    const paymentLabel = paymentMethodLabel(props.paymentMethod);
    const paymentIconClass = props.paymentMethod === 'pix' ? 'ri-qr-code-line' : props.paymentMethod === 'card' ? 'ri-bank-card-fill' : 'ri-money-dollar-box-fill';
    const paymentIconColor = props.paymentMethod === 'pix' ? 'text-teal-500' : props.paymentMethod === 'card' ? 'text-blue-500' : 'text-brand-500'
    const fareValue = props.fare?.fare?.[props.vehicleType]
    const fareLabel = formatCurrencyBRL(fareValue)
    const distanceLabel = formatDistanceLabel(props.fare?.distance)
    const durationLabel = formatDurationLabel(props.fare?.time)
    const isEstimate = props.fare?.showAsEstimate !== false
    const breakdown = props.fare?.breakdown?.[props.vehicleType] || {}
    const subtotal = breakdown.subtotalBeforeCommission ?? breakdown.subtotal ?? breakdown.baseFare
    const discount = props.fare?.discountAmount
    const hasBreakdown = subtotal != null || discount > 0 || distanceLabel || durationLabel

    return (
        <div className='pb-2'>
            <div className='flex items-center justify-between gap-2 mb-2'>
                <div className='flex items-center gap-2 min-w-0'>
                    <div className='flex-shrink-0 h-11 w-12 rounded-lg bg-brand-50 flex items-center justify-center'>
                        <img
                            className='h-7 w-10 object-contain'
                            src={vehicleImages[props.vehicleType] || vehicleImages.car}
                            alt=""
                            loading="lazy"
                        />
                    </div>
                    <div className='min-w-0'>
                        <h3 className='text-[15px] font-bold text-ink-900 truncate leading-tight'>Confirmar corrida</h3>
                        <p className='text-[11px] text-ink-400 truncate'>{vehicleLabels[props.vehicleType]}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => props.setOptionalsPanel(true)}
                    className='min-h-[36px] px-2.5 rounded-full border border-line text-[11px] font-semibold text-ink-600 active:bg-surface-alt flex items-center gap-1 flex-shrink-0'
                >
                    <i className="ri-box-3-fill text-brand-500 text-sm" aria-hidden="true"></i> Opcionais
                </button>
            </div>

            <div className='flex flex-col gap-1.5'>
                <RouteCard
                    pickup={extractTitle(props.pickup)}
                    destination={extractTitle(props.destination)}
                    pickupLabel="Ponto de partida"
                />

                <Card padding='p-0' className='divide-y divide-line'>
                    <button
                        type="button"
                        onClick={() => props.setPaymentPanel(true)}
                        className='w-full flex items-center gap-2.5 px-2.5 py-2 text-left active:bg-surface-alt'
                    >
                        <span className='flex-shrink-0 h-8 w-8 rounded-full bg-surface-alt flex items-center justify-center'>
                            <i className={`${paymentIconClass} ${paymentIconColor} text-base`} aria-hidden="true"></i>
                        </span>
                        <span className='flex-1 min-w-0'>
                            <span className='block text-[13px] font-bold text-ink-900 leading-tight truncate'>{paymentLabel}</span>
                            <span className='block text-[11px] text-ink-400 leading-tight'>Pagamento</span>
                        </span>
                        <i className="ri-arrow-right-s-line text-base text-ink-400 flex-shrink-0" aria-hidden="true"></i>
                    </button>

                    <div className='flex items-center gap-2.5 px-2.5 py-2'>
                        <span className='flex-shrink-0 h-8 w-8 rounded-full bg-surface-alt flex items-center justify-center'>
                            <i className="ri-money-dollar-circle-line text-brand-500 text-base" aria-hidden="true"></i>
                        </span>
                        <div className='flex-1 min-w-0'>
                            <p className='text-[13px] font-bold text-ink-900 leading-tight truncate'>
                                {fareValue != null ? fareLabel : 'Preço indisponível'}
                            </p>
                            <p className='text-[11px] text-ink-400 leading-tight'>
                                {isEstimate ? 'Estimativa da corrida' : 'Valor da corrida'}
                            </p>
                        </div>
                    </div>
                </Card>

                {hasBreakdown && (
                    <Card padding='p-2.5' className='space-y-2'>
                        <div className='flex items-center justify-between gap-3'>
                            <p className='text-[13px] font-bold text-ink-900'>Resumo do preço</p>
                            <p className='text-[15px] font-bold text-ink-900 tabular-nums'>{fareLabel}</p>
                        </div>

                        {/* Distância e tempo em blocos próprios: são os dois números que
                            explicam o preço, e como texto corrido eles se perdiam no meio
                            das outras linhas do resumo. */}
                        {(distanceLabel || durationLabel) && (
                            <div className='grid grid-cols-2 gap-1.5'>
                                {distanceLabel && (
                                    <div className='rounded-lg bg-surface-alt px-2 py-1.5 flex items-center gap-2'>
                                        <i className="ri-road-map-line text-brand-500 text-base flex-shrink-0" aria-hidden="true"></i>
                                        <div className='min-w-0'>
                                            <p className='text-[10px] text-ink-400 leading-tight'>Distância</p>
                                            <p className='text-[13px] font-bold text-ink-900 leading-tight tabular-nums'>{distanceLabel}</p>
                                        </div>
                                    </div>
                                )}
                                {durationLabel && (
                                    <div className='rounded-lg bg-surface-alt px-2 py-1.5 flex items-center gap-2'>
                                        <i className="ri-time-line text-brand-500 text-base flex-shrink-0" aria-hidden="true"></i>
                                        <div className='min-w-0'>
                                            <p className='text-[10px] text-ink-400 leading-tight'>Tempo estimado</p>
                                            <p className='text-[13px] font-bold text-ink-900 leading-tight tabular-nums'>{durationLabel}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {(subtotal != null || discount > 0) && (
                            <div className='border-t border-line pt-1.5 space-y-1'>
                                {subtotal != null && (
                                    <div className='flex items-center justify-between gap-3'>
                                        <p className='text-[12px] font-semibold text-ink-900'>Corrida</p>
                                        <p className='text-[13px] font-bold text-ink-900 tabular-nums'>{formatCurrencyBRL(subtotal)}</p>
                                    </div>
                                )}
                                {discount > 0 && (
                                    <div className='flex items-center justify-between gap-3'>
                                        <p className='text-[12px] font-semibold text-brand-600'>Desconto</p>
                                        <p className='text-[13px] font-bold text-brand-600 tabular-nums'>- {formatCurrencyBRL(discount)}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <p className='text-[10px] text-ink-400 leading-snug'>
                            {isEstimate
                                ? 'Valor estimado antes da corrida; o valor final pode variar conforme rota, tempo real, espera e adicionais.'
                                : 'Valor calculado para esta solicitação antes de chamar o motorista.'}
                        </p>
                    </Card>
                )}

                {/* Bloco H (2026-08-02): cupom é opcional — o código só é enviado junto
                    com a criação da corrida (sem endpoint de validação separado); um
                    código inválido não trava a confirmação, só não desconta nada. */}
                <div className='flex items-center gap-2 border border-line rounded-panel px-2.5 py-2'>
                    <i className="ri-coupon-3-line text-brand-500 text-base flex-shrink-0" aria-hidden="true"></i>
                    <input
                        type="text"
                        value={props.promoCode}
                        onChange={(e) => props.setPromoCode(e.target.value.toUpperCase())}
                        placeholder="Cupom (opcional)"
                        className='flex-1 text-[13px] text-ink-900 placeholder:text-ink-400 outline-none bg-transparent min-w-0'
                    />
                </div>
            </div>

            <Button
                onClick={() => {
                    props.setVehicleFound(true)
                    props.setConfirmRidePanel(false)
                    props.createRide()
                }}
                trailingIcon="ri-arrow-right-line"
                className='mt-2.5 !min-h-[46px] !text-sm'
            >
                {fareValue != null
                    ? `Solicitar corrida — ${isEstimate ? 'estimativa ' : ''}${fareLabel}`
                    : 'Solicitar corrida'}
            </Button>
        </div>
    )
}

export default ConfirmRide
