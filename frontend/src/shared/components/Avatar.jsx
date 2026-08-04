import React from 'react'

// Avatar com foto real quando houver URL; senão iniciais.
const Avatar = ({ firstname, lastname, src, size = 'h-12 w-12', className = '' }) => {
    const initials = `${firstname?.[0] || ''}${lastname?.[0] || ''}`.toUpperCase() || '?'

    if (src) {
        return (
            <div className={`${size} rounded-full overflow-hidden flex-shrink-0 bg-surface-alt ${className}`}>
                <img src={src} alt={firstname || 'Avatar'} className="w-full h-full object-cover" loading="lazy" />
            </div>
        )
    }

    return (
        <div className={`${size} rounded-full bg-green-500 text-white flex items-center justify-center font-bold flex-shrink-0 ${className}`}>
            <span style={{ fontSize: '0.9em' }}>{initials}</span>
        </div>
    )
}

export default Avatar
