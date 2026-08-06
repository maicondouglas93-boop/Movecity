import React, { useContext } from 'react'
import Button from '@/shared/components/ui/Button'
import PassengerIdentityCard from '@/shared/components/PassengerIdentityCard'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { vehicleLabels } from '@/shared/assets/vehicleAssets'

// Fase B da experiência de corrida ativa (2026-08-03): o countdown de 20s saiu. Ele só
// escondia o painel no frontend, sem declinar nada no servidor — a corrida continuava
// 'requested' no banco, mas sumia da tela do motorista para sempre (estado fantasma).
// Agora a oferta só sai da tela quando: o motorista aceita, outro motorista aceita
// ('ride-taken'), o passageiro cancela ('ride-cancelled') ou o motorista toca "Ignorar"
// — e mesmo ignorada ela continua acessível no card "Corrida disponível" da Home.

const haversineKm = (a, b) => {
    if (!a || !b) return null
    const toRad = (v) => (v * Math.PI) / 180
    const R = 6371
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const sinA = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(sinA), Math.sqrt(1 - sinA))
}

const RidePopUp = (props) => {
    const { userLocation } = useContext(LocationContext)

    // §2.10 do relatório: a distância até o passageiro (não a distância DA corrida) é a
    // informação que mais pesa na decisão de aceitar — antes não existia em lugar nenhum.
    const distanceToPickupKm = haversineKm(userLocation, props.ride?.pickupCoordinates)
    const vehicleLabel = vehicleLabels[props.ride?.vehicleType] || props.ride?.vehicleType
    const etaMins = props.ride?.estimatedTime ? Math.round(props.ride.estimatedTime / 60) : null
    const tripKm = props.ride?.estimatedDistance
        ? (props.ride.estimatedDistance / 1000).toFixed(1)
        : null
    const payLabel = props.ride?.paymentMethod === 'card'
        ? 'Cartão'
        : props.ride?.paymentMethod === 'pix'
            ? 'PIX'
            : 'Dinheiro'

    return (
        <div className="pb-1">
            <div className='flex items-center justify-between mb-2.5'>
                <h3 className='text-base font-semibold text-ink-900'>Nova corrida</h3>
                {props.ride?.fare != null && (
                    <p className="text-lg font-bold text-ink-900">
                        R$ {props.ride?.fare?.toFixed ? props.ride.fare.toFixed(2) : props.ride?.fare}
                    </p>
                )}
            </div>

            {/* Oferta: sem foto (privacidade pré-aceite) — só primeiro nome. */}
            <PassengerIdentityCard
                user={{
                    fullname: { firstname: props.ride?.user?.fullname?.firstname || 'Passageiro' },
                }}
                showPhoto={false}
                compact
                subtitle={vehicleLabel}
                trailing={
                    <div className="text-right">
                        <p className="text-base font-bold text-ink-900">
                            {distanceToPickupKm != null ? `${distanceToPickupKm.toFixed(1)} km` : '—'}
                        </p>
                        <p className="text-[10px] text-ink-500">até você</p>
                    </div>
                }
            />

            <div className='mt-2.5 space-y-1.5'>
                <p className='text-xs text-ink-700 flex items-center gap-2 min-w-0'>
                    <i className="ri-map-pin-user-fill text-brand-500 flex-shrink-0" aria-hidden="true" />
                    <span className="truncate font-medium">{props.ride?.pickup?.split(',')[0]}</span>
                </p>
                <p className='text-xs text-ink-700 flex items-center gap-2 min-w-0'>
                    <i className="ri-map-pin-2-fill text-danger-500 flex-shrink-0" aria-hidden="true" />
                    <span className="truncate font-medium">{props.ride?.destination?.split(',')[0]}</span>
                </p>
                <div className='flex items-center gap-3 text-[11px] text-ink-500 pt-0.5'>
                    <span className="inline-flex items-center gap-1">
                        <i className="ri-time-line text-amber-500" aria-hidden="true" />
                        {etaMins != null ? `${etaMins} min` : '—'}
                        {tripKm ? ` · ${tripKm} km` : ''}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <i className="ri-bank-card-line" aria-hidden="true" />
                        {payLabel}
                    </span>
                    {(props.ride?.fare != null || props.ride?.finalPrice != null) && (
                        <span className="text-brand-600 font-semibold ml-auto">
                            R$ {Number(props.ride.finalPrice ?? props.ride.fare).toFixed(2)}
                        </span>
                    )}
                </div>
            </div>

            <div className='mt-3 w-full flex gap-2'>
                <Button
                    onClick={() => {
                        props.setConfirmRidePopupPanel(true)
                        props.confirmRide()
                    }}
                    fullWidth={false}
                    className="flex-1 !min-h-[44px] !text-sm"
                >
                    <i className="ri-checkbox-circle-line mr-1"></i>Aceitar
                </Button>
                <Button
                    variant="secondary"
                    fullWidth={false}
                    className="flex-1 !min-h-[44px] !text-sm"
                    onClick={() => {
                        // Espelha parcel: ACK de recusa no backend (nativo já fazia isso).
                        if (typeof props.onDecline === 'function') {
                            props.onDecline(props.ride)
                        } else {
                            props.setRidePopupPanel(false)
                        }
                    }}
                >Ignorar</Button>
            </div>
        </div>
    )
}

export default RidePopUp
