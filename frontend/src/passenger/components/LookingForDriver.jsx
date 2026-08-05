import React, { useEffect, useState } from 'react'
import { vehicleImages } from '@/shared/assets/vehicleAssets'
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

    const minutes = Math.floor(elapsedSeconds / 60)
    const seconds = elapsedSeconds % 60
    const elapsedLabel = `${minutes}:${String(seconds).padStart(2, '0')}`
    const isTakingLong = elapsedSeconds >= 60
    const fareValue = props.fare?.fare?.[props.vehicleType]

    return (
        <div className='pb-2'>
            <div className='flex items-center gap-3 mb-3'>
                <div className='relative h-12 w-12 flex-shrink-0 flex items-center justify-center'>
                    <div className='absolute inset-0 rounded-full border-2 border-brand-300 animate-ping opacity-55'></div>
                    <img
                        className='h-10 w-10 absolute rounded-full object-contain bg-surface p-0.5 shadow-raised border border-brand-200'
                        src={vehicleImages[props.vehicleType] || vehicleImages.car}
                        alt=""
                        width="1024"
                        height="1024"
                        loading="lazy"
                    />
                </div>
                <div className='min-w-0 flex-1'>
                    <h3 className='text-base font-semibold text-ink-900 leading-tight'>Buscando motorista</h3>
                    <p className='text-xs text-brand-700 mt-0.5'>
                        Próximos… <span className='tabular-nums text-ink-400'>{elapsedLabel}</span>
                    </p>
                </div>
                {fareValue != null && (
                    <div className='text-right flex-shrink-0'>
                        <p className='text-sm font-bold text-ink-900'>R${fareValue}</p>
                        <p className='text-[11px] text-ink-400'>{paymentLabel(props.paymentMethod)}</p>
                    </div>
                )}
            </div>

            {isTakingLong && (
                <div className='flex gap-2 items-center bg-surface-alt rounded-panel px-2.5 py-2 mb-2.5'>
                    <i className="ri-time-line text-ink-400 text-base flex-shrink-0" aria-hidden="true"></i>
                    <p className='text-xs text-ink-600'>Demorando mais que o normal — aguarde ou cancele.</p>
                </div>
            )}

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

            <Button variant='danger' onClick={handleCancel} loading={cancelling} className='mt-3 !min-h-[44px] !text-sm'>
                {cancelling ? 'Cancelando...' : confirmingCancel ? 'Toque de novo para confirmar' : 'Cancelar corrida'}
            </Button>
        </div>
    )
}

export default LookingForDriver
