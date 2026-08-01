import React from 'react'
import { vehicleImages, vehicleLabels } from '@/assets/vehicleAssets'
import Card from '@/shared/components/ui/Card'
import DetailRow from '@/shared/components/ui/DetailRow'
import StatusBadge from '@/shared/components/ui/StatusBadge'

const paymentLabel = (method) => method === 'pix' ? 'Pix' : method === 'carteira' ? 'Carteira' : method === 'card' ? 'Cartão' : 'Dinheiro'

// P3.1 da auditoria de concorrência (2026-08-02): o backend emite 'ride-status-updated'
// a cada "a caminho"/"cheguei" do motorista, mas até então nenhuma tela do passageiro
// escutava — essa tela ficava com os dados congelados do momento do aceite a corrida
// inteira. Agora reflete o status real da corrida em tempo real.
const statusInfo = (status) => {
    if (status === 'arrived' || status === 'waiting_passenger') {
        return { label: 'Motorista chegou', tone: 'success' };
    }
    if (status === 'going_to_pickup' || status === 'accepted') {
        return { label: 'Motorista a caminho', tone: 'info' };
    }
    return null;
};

const WaitingForDriver = (props) => {
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
    if (!props.ride) return null

    const captainVehicleType = props.ride?.captain?.vehicle?.vehicleType || props.ride?.vehicleType || 'car'
    const vehicleImg = vehicleImages[captainVehicleType] || vehicleImages.car
    const vehicleLabel = vehicleLabels[captainVehicleType] || 'MoveGo'
    const status = statusInfo(props.ride?.status)

    return (
        <div className='pb-6'>
            <button
                type="button"
                onClick={() => props.setWaitingForDriver(false)}
                aria-label="Fechar"
                className='absolute right-1/2 translate-x-1/2 top-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400'
            >
                <i className="text-2xl ri-arrow-down-wide-line" aria-hidden="true"></i>
            </button>

            {status && (
                <div className='flex justify-center mb-3'>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </div>
            )}

            <div className='flex items-center justify-between mb-4'>
                <div>
                    <img className='h-14 object-contain' src={vehicleImg} alt={captainVehicleType} />
                    <p className='text-xs text-center text-ink-400 mt-1 font-medium'>{vehicleLabel}</p>
                </div>
                <div className='text-right'>
                    <h2 className='text-base font-medium capitalize text-ink-900'>{props.ride?.captain?.fullname?.firstname} {props.ride?.captain?.fullname?.lastname}</h2>
                    <h4 className='text-lg font-semibold -mt-1 -mb-1 text-brand-700'>{props.ride?.captain?.vehicle?.plate}</h4>
                    <p className='text-sm text-ink-400 capitalize'>{props.ride?.captain?.vehicle?.color} {captainVehicleType}</p>
                </div>
            </div>

            <div className='flex justify-between items-center p-3 bg-brand-50 border-2 border-brand-200 rounded-panel'>
                <div>
                    <p className='text-sm text-ink-400 mb-1'>Compartilhe o PIN com o motorista</p>
                    <h1 className='text-3xl font-bold tracking-widest text-brand-600'>{props.ride?.otp}</h1>
                </div>
                <i className="ri-lock-2-line text-3xl text-brand-500" aria-hidden="true"></i>
            </div>

            <Card padding='p-1' className='divide-y divide-line mt-4'>
                <DetailRow
                    icon="ri-map-pin-user-fill"
                    title={extractTitle(props.ride?.pickup)}
                    subtitle={extractAddress(props.ride?.pickup)}
                    className='px-3'
                />
                <DetailRow
                    icon="ri-map-pin-2-fill"
                    iconColor="text-danger-500"
                    title={extractTitle(props.ride?.destination)}
                    subtitle={extractAddress(props.ride?.destination)}
                    className='px-3'
                />
                <DetailRow
                    icon="ri-currency-line"
                    title={props.ride?.fare ? `R$${props.ride.fare}` : ''}
                    subtitle={paymentLabel(props.ride?.paymentMethod)}
                    className='px-3'
                />
            </Card>
        </div>
    )
}

export default WaitingForDriver
