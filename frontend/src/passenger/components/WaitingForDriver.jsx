import React, { useEffect, useState } from 'react'
import RouteCard from '@/shared/components/ui/RouteCard'
import Button from '@/shared/components/ui/Button'
import DriverIdentityCard from '@/shared/components/DriverIdentityCard'
import { formatCurrencyBRL, paymentMethodLabel } from '@/shared/utils/formatters'
import PassengerSafetyCenter from '@/passenger/components/PassengerSafetyCenter'
import { copyTextToClipboard } from '@/shared/utils/clipboard'

const paymentLabel = paymentMethodLabel

const STATUS = {
    accepted: {
        title: 'Motorista confirmado',
        text: 'Ele está se preparando para ir até você.',
        icon: 'ri-checkbox-circle-fill',
    },
    going_to_pickup: {
        title: 'Motorista a caminho',
        text: 'Acompanhe a aproximação pelo mapa.',
        icon: 'ri-navigation-fill',
    },
    arrived: {
        title: 'Motorista chegou',
        text: 'Vá ao local de embarque e confirme a placa.',
        icon: 'ri-map-pin-time-fill',
    },
    waiting_passenger: {
        title: 'Motorista esperando',
        text: 'Compartilhe o PIN somente depois de conferir o veículo.',
        icon: 'ri-time-fill',
    },
}

// Painel sempre aberto: identidade + PIN + trajeto + cancelar — sem expandir/rolar.
const WaitingForDriver = (props) => {
    const [ confirmingCancel, setConfirmingCancel ] = useState(false)
    const [ cancelling, setCancelling ] = useState(false)
    const [ copiedPin, setCopiedPin ] = useState(false)

    useEffect(() => {
        if (!confirmingCancel) return
        const timer = setTimeout(() => setConfirmingCancel(false), 5000)
        return () => clearTimeout(timer)
    }, [confirmingCancel])

    const handleCancel = async () => {
        if (cancelling) return
        if (!confirmingCancel) {
            setConfirmingCancel(true)
            return
        }
        setCancelling(true)
        try {
            await props.cancelRide()
        } finally {
            setCancelling(false)
            setConfirmingCancel(false)
        }
    }

    const extractTitle = (addressStr) => {
        if (!addressStr) return '';
        if (typeof addressStr === 'object') return addressStr.address?.split(',')[0] || '';
        return addressStr.split(',')[0] || '';
    };

    if (!props.ride) return null

    const fareLabel = props.ride?.fare != null
        ? `${formatCurrencyBRL(props.ride.fare)} · ${paymentLabel(props.ride?.paymentMethod)}`
        : null
    const cancellationFee = Number(props.ride?.cancellationFeePreview ?? props.ride?.cancellationFeeCharged ?? 0)
    const cancellationText = cancellationFee > 0
        ? `Taxa prevista de cancelamento: ${formatCurrencyBRL(cancellationFee)}.`
        : 'Regra de taxa de cancelamento: cancelar antes do início normalmente não cobra taxa; se houver regra local aplicada, ela será informada na confirmação.'
    const rideStatus = STATUS[props.ride.status] || STATUS.accepted
    const remainingKm = props.approachProgress?.remainingKm
    const etaMinutes = props.approachProgress?.etaMinutes

    const copyPin = async () => {
        const pin = String(props.ride?.otp || '')
        if (!pin) return
        try {
            await copyTextToClipboard(pin)
            setCopiedPin(true)
            setTimeout(() => setCopiedPin(false), 2000)
        } catch {
            setCopiedPin(false)
        }
    }

    return (
        <div className="pb-1">
            <div className="mb-2.5 flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5" aria-live="polite">
                <div className="h-9 w-9 flex-shrink-0 rounded-full bg-brand-500 text-white flex items-center justify-center">
                    <i className={rideStatus.icon} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink-900">{rideStatus.title}</p>
                    <p className="text-xs text-ink-600">{rideStatus.text}</p>
                </div>
                {(remainingKm != null || etaMinutes != null) && !['arrived', 'waiting_passenger'].includes(props.ride.status) && (
                    <div className="text-right flex-shrink-0">
                        {etaMinutes != null && <p className="text-sm font-bold text-brand-700">~{etaMinutes} min</p>}
                        {remainingKm != null && <p className="text-[11px] text-ink-500">{Number(remainingKm).toFixed(1)} km</p>}
                    </div>
                )}
            </div>

            <DriverIdentityCard
                captain={props.ride?.captain}
                vehicleTypeFallback={props.ride?.vehicleType}
                fareLabel={fareLabel}
                compact
            />

            <button
                type="button"
                onClick={copyPin}
                className="mt-2.5 w-full flex items-center gap-3 rounded-xl bg-brand-50 border border-brand-200 px-3 py-2 active:bg-brand-100"
                aria-label="Copiar PIN da corrida"
            >
                <p className="text-xs text-ink-500 flex-shrink-0">PIN</p>
                <p className="flex-1 text-center text-2xl font-bold tracking-[0.35em] text-brand-600 leading-none">
                    {props.ride?.otp}
                </p>
                <i className={`${copiedPin ? 'ri-checkbox-circle-fill' : 'ri-file-copy-line'} text-lg text-brand-500 flex-shrink-0`} aria-hidden="true" />
            </button>
            {copiedPin && <p className="mt-1 text-center text-[11px] font-medium text-brand-700">PIN copiado</p>}

            <RouteCard
                layout="split"
                className="mt-2.5"
                pickup={extractTitle(props.ride?.pickup)}
                destination={extractTitle(props.ride?.destination)}
            />

            <div className="mt-2.5 grid grid-cols-3 gap-2">
                <button
                    type="button"
                    onClick={props.onOpenChat}
                    className="min-h-[44px] rounded-full border border-line bg-surface text-sm font-semibold text-ink-700 flex items-center justify-center gap-1.5"
                >
                    <i className="ri-chat-3-fill text-brand-600" aria-hidden="true" /> Chat
                </button>
                {props.ride?.captain?.phone ? (
                    <a
                        href={`tel:${props.ride.captain.phone}`}
                        className="min-h-[44px] rounded-full border border-line bg-surface text-sm font-semibold text-ink-700 flex items-center justify-center gap-1.5"
                    >
                        <i className="ri-phone-fill text-brand-600" aria-hidden="true" /> Ligar
                    </a>
                ) : (
                    <button
                        type="button"
                        disabled
                        className="min-h-[44px] rounded-full border border-line bg-surface-alt text-sm font-semibold text-ink-400 flex items-center justify-center gap-1.5"
                    >
                        <i className="ri-phone-line" aria-hidden="true" /> Ligar
                    </button>
                )}
                <PassengerSafetyCenter ride={props.ride} captainLocation={props.captainLocation} />
            </div>

            {props.cancelRide && (
                <>
                    <Button
                        variant="danger"
                        onClick={handleCancel}
                        loading={cancelling}
                        className="mt-2.5 !min-h-[44px] !text-sm"
                    >
                        {cancelling
                            ? 'Cancelando...'
                            : confirmingCancel ? 'Toque de novo para confirmar' : 'Cancelar corrida'}
                    </Button>
                    {confirmingCancel && !cancelling && (
                        <p className="text-[11px] text-center text-ink-400 mt-1.5">
                            {cancellationText}
                        </p>
                    )}
                </>
            )}
        </div>
    )
}

export default WaitingForDriver
