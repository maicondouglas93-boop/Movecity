import React from 'react'
import Avatar from '@/shared/components/Avatar'
import {
    formatRating,
    personFirstName,
    personLastName,
    personName,
    personPhoto,
} from '@/shared/utils/identity'

/**
 * Identidade do passageiro após vínculo confirmado (ride/parcel).
 * Em ofertas (pré-aceite), passe showPhoto={false} para não expor a foto.
 */
const PassengerIdentityCard = ({
    user,
    showPhoto = true,
    subtitle = 'Passageiro',
    trailing,
    compact = false,
    className = '',
}) => {
    if (!user) return null

    const name = personName(user) || 'Passageiro'
    const rating = formatRating(user.rating)
    const size = compact ? 'h-11 w-11' : 'h-12 w-12'

    return (
        <div
            className={`flex items-center gap-3 ${
                compact ? '' : 'rounded-panel border border-line bg-brand-50 border-brand-100 p-3'
            } ${className}`}
        >
            <Avatar
                firstname={personFirstName(user)}
                lastname={personLastName(user)}
                src={showPhoto ? personPhoto(user) : ''}
                size={size}
                alt={name}
                className={compact ? '' : 'border-2 border-white'}
            />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-900 truncate capitalize">{name}</p>
                <p className="text-xs text-ink-400 truncate">
                    {rating ? `★ ${rating}` : subtitle}
                    {rating && subtitle ? ` · ${subtitle}` : ''}
                </p>
            </div>
            {trailing != null ? (
                <div className="text-right flex-shrink-0">{trailing}</div>
            ) : null}
        </div>
    )
}

export default PassengerIdentityCard
