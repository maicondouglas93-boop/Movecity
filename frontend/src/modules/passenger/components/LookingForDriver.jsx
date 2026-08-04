import React, { useEffect, useState } from 'react'
import { vehicleImages } from '@/assets/vehicleAssets'
import Card from '@/shared/components/ui/Card'
import DetailRow from '@/shared/components/ui/DetailRow'
import Button from '@/shared/components/ui/Button'

const paymentLabel = (method) => method === 'pix' ? 'Pix' : method === 'carteira' ? 'Carteira' : method === 'card' ? 'Cartão' : 'Dinheiro'

// O backend expira a corrida sozinha depois de 10min sem motorista aceitar, mas não
// avisa o app (a expiração só é detectada na próxima vez que algo consulta a corrida
// atual). Sem um evento pra escutar, o melhor que dá pra fazer aqui — sem alterar
// lógica de busca/matching — é parar de deixar o "Buscando..." parecer congelado:
// mostrar o tempo decorrido e, depois de 1min, uma mensagem honesta de que está
// demorando mais que o normal. Ver item 5/§9 da auditoria de UX.
const LookingForDriver = (props) => {
    const [elapsedSeconds, setElapsedSeconds] = useState(0)
    // Implementação do sistema de cancelamento (2026-08-04): mesmo padrão de
    // confirmação já usado em WaitingForDriver.jsx — evita cancelamento acidental,
    // sem o custo de um modal separado pra um estágio de baixo risco (nenhum
    // motorista comprometido ainda).
    const [confirmingCancel, setConfirmingCancel] = useState(false)
    const [cancelling, setCancelling] = useState(false)

    useEffect(() => {
        const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
        return () => clearInterval(interval)
    }, [])

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

    const extractAddress = (addressStr) => {
        if (!addressStr) return '';
        if (typeof addressStr === 'object') return addressStr.address;
        return addressStr.replace(/\s*\(-?\d+\.\d+,\s*-?\d+\.\d+\)$/, '');
    };

    const minutes = Math.floor(elapsedSeconds / 60)
    const seconds = elapsedSeconds % 60
    const elapsedLabel = `${minutes}:${String(seconds).padStart(2, '0')}`
    const isTakingLong = elapsedSeconds >= 60

    return (
        <div className='pb-6'>
            <button
                type="button"
                onClick={() => props.setVehicleFound(false)}
                aria-label="Fechar"
                className='absolute right-1/2 translate-x-1/2 top-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400'
            >
                <i className="text-2xl ri-arrow-down-wide-line" aria-hidden="true"></i>
            </button>
            <h3 className='text-2xl font-semibold mb-5 text-ink-900'>Buscando um Motorista</h3>

            <div className='flex flex-col items-center mb-4'>
                <div className='relative h-16 w-16 flex items-center justify-center'>
                    <div className='absolute inset-0 rounded-full border-4 border-brand-300 animate-ping opacity-55'></div>
                    <div className='absolute inset-2 rounded-full border-4 border-brand-400 animate-ping opacity-75 animation-delay-150'></div>
                    <img className='h-12 w-12 absolute rounded-full object-contain bg-surface p-1 shadow-raised border border-brand-200' src={vehicleImages[props.vehicleType] || vehicleImages.car} alt="" width="1024" height="1024" loading="lazy" />
                </div>
                <p className='text-sm text-brand-700 mt-2'>Buscando motoristas próximos...</p>
                <p className='text-xs text-ink-400 mt-1 tabular-nums'>{elapsedLabel}</p>
            </div>

            {isTakingLong && (
                <div className='flex gap-2 items-start bg-surface-alt rounded-panel p-3 mb-4'>
                    <i className="ri-time-line text-ink-400 text-lg flex-shrink-0 mt-0.5" aria-hidden="true"></i>
                    <p className='text-sm text-ink-600'>Isso está demorando mais que o normal. Você pode continuar aguardando ou cancelar a busca.</p>
                </div>
            )}

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
                <DetailRow
                    icon="ri-currency-line"
                    title={props.fare?.fare?.[props.vehicleType] ? `R$${props.fare.fare[props.vehicleType]}` : ''}
                    subtitle={`${paymentLabel(props.paymentMethod)} (Estimativa)`}
                    className='px-3'
                />
            </Card>

            <Button variant='danger' onClick={handleCancel} loading={cancelling} className='mt-4'>
                {cancelling ? 'Cancelando...' : confirmingCancel ? 'Toque de novo para confirmar' : 'Cancelar Corrida'}
            </Button>
        </div>
    )
}

export default LookingForDriver
