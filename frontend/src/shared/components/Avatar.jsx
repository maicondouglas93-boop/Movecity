import React, { useState } from 'react'

/**
 * Avatar com foto real quando houver URL válida; senão iniciais.
 * Em erro de carga da imagem, cai automaticamente no fallback de iniciais.
 */
const Avatar = ({
    firstname,
    lastname,
    src,
    size = 'h-12 w-12',
    className = '',
    alt,
}) => {
    const [failed, setFailed] = useState(false)
    const initials = `${firstname?.[0] || ''}${lastname?.[0] || ''}`.toUpperCase() || '?'
    const photo = typeof src === 'string' && src.trim() && !failed ? src.trim() : null

    if (photo) {
        return (
            <div className={`${size} rounded-full overflow-hidden flex-shrink-0 bg-surface-alt ${className}`}>
                <img
                    src={photo}
                    alt={alt || firstname || 'Avatar'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={() => setFailed(true)}
                />
            </div>
        )
    }

    return (
        <div
            className={`${size} rounded-full bg-brand-500 text-white flex items-center justify-center font-bold flex-shrink-0 ${className}`}
            aria-hidden={false}
            role="img"
            aria-label={alt || firstname || 'Avatar'}
        >
            <span className="text-[0.9em] leading-none">{initials}</span>
        </div>
    )
}

export default Avatar
