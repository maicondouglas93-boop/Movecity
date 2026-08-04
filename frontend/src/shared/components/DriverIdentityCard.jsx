import React from 'react'
import Avatar from '@/shared/components/Avatar'
import {
    formatRating,
    personFirstName,
    personLastName,
    personName,
    personPhoto,
    vehicleSummary,
} from '@/shared/utils/identity'

/**
 * Identidade do motorista após vínculo confirmado (ride/parcel).
 * Usa apenas dados do documento captain populado — sem mocks.
 */
const DriverIdentityCard = ({
    captain,
    vehicleTypeFallback,
    fareLabel,
    compact = false,
    className = '',
}) => {
    if (!captain) return null

    const name = personName(captain) || 'Motorista'
    const rating = formatRating(captain.rating)
    const vehicle = vehicleSummary(captain, vehicleTypeFallback)
    const size = compact ? 'h-11 w-11' : 'h-12 w-12'

    return (
        <div
            className={`flex items-center gap-3 ${
                compact ? '' : 'rounded-panel border border-line bg-surface-alt p-3'
            } ${className}`}
        >
            <Avatar
                firstname={personFirstName(captain)}
                lastname={personLastName(captain)}
                src={personPhoto(captain)}
                size={size}
                alt={name}
            />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-900 truncate capitalize">{name}</p>
                <p className="text-xs text-ink-400 truncate capitalize">
                    {rating ? `★ ${rating}` : null}
                    {rating && vehicle.line ? ' · ' : ''}
                    {vehicle.line}
                </p>
            </div>
            <div className="text-right flex-shrink-0">
                {vehicle.plate ? (
                    <p className="text-sm font-bold text-brand-700 tracking-wide leading-tight">
                        {vehicle.plate}
                    </p>
                ) : null}
                {fareLabel ? (
                    <p className="text-xs text-ink-400 mt-0.5">{fareLabel}</p>
                ) : null}
            </div>
        </div>
    )
}

export default DriverIdentityCard
