import React, { useEffect, useState } from 'react'
import Button from '@/shared/components/ui/Button'
import DriverIdentityCard from '@/shared/components/DriverIdentityCard'

const paymentLabel = (method) => method === 'pix' ? 'Pix' : method === 'carteira' ? 'Carteira' : method === 'card' ? 'Cartão' : 'Dinheiro'

// Painel compacto: após aceite — identidade do motorista + PIN + cancelar.
const WaitingForDriver = (props) => {
    const [ confirmingCancel, setConfirmingCancel ] = useState(false)
    const [ cancelling, setCancelling ] = useState(false)
    const [ detailsOpen, setDetailsOpen ] = useState(false)

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
        ? `R$${props.ride.fare} · ${paymentLabel(props.ride?.paymentMethod)}`
        : null

    return (
        <div className="pb-2">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" aria-hidden="true" />

            <DriverIdentityCard
                captain={props.ride?.captain}
                vehicleTypeFallback={props.ride?.vehicleType}
                fareLabel={fareLabel}
                compact
            />

            <div className="mt-2.5 flex items-center gap-3 rounded-xl bg-brand-50 border border-brand-200 px-3 py-2">
                <p className="text-xs text-ink-500 flex-shrink-0">PIN</p>
                <p className="flex-1 text-center text-2xl font-bold tracking-[0.35em] text-brand-600 leading-none">
                    {props.ride?.otp}
                </p>
                <i className="ri-lock-2-line text-lg text-brand-500 flex-shrink-0" aria-hidden="true" />
            </div>

            <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="mt-2 w-full flex items-center justify-center gap-1 text-xs font-medium text-ink-400 py-1"
                aria-expanded={detailsOpen}
            >
                {detailsOpen ? 'Ocultar detalhes' : 'Ver origem e destino'}
                <i className={`ri-arrow-${detailsOpen ? 'up' : 'down'}-s-line text-sm`} aria-hidden="true" />
            </button>

            {detailsOpen && (
                <div className="mb-1 px-1 space-y-1.5">
                    <p className="text-xs text-ink-600 flex items-start gap-2">
                        <i className="ri-map-pin-user-fill text-brand-500 mt-0.5" aria-hidden="true" />
                        <span className="truncate">{extractTitle(props.ride?.pickup)}</span>
                    </p>
                    <p className="text-xs text-ink-600 flex items-start gap-2">
                        <i className="ri-map-pin-2-fill text-danger-500 mt-0.5" aria-hidden="true" />
                        <span className="truncate">{extractTitle(props.ride?.destination)}</span>
                    </p>
                </div>
            )}

            {props.cancelRide && (
                <>
                    <Button
                        variant="danger"
                        onClick={handleCancel}
                        loading={cancelling}
                        className="mt-1 !min-h-[40px] !text-sm"
                    >
                        {cancelling
                            ? 'Cancelando...'
                            : confirmingCancel ? 'Toque de novo para confirmar' : 'Cancelar corrida'}
                    </Button>
                    {confirmingCancel && !cancelling && (
                        <p className="text-[11px] text-center text-ink-400 mt-1.5">
                            Pode haver taxa de cancelamento.
                        </p>
                    )}
                </>
            )}
        </div>
    )
}

export default WaitingForDriver
