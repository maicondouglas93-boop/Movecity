import React from 'react'

const TONES = {
    success: 'bg-brand-50 text-brand-600',
    warning: 'bg-amber-50 text-amber-600',
    danger: 'bg-danger-50 text-danger-600',
    info: 'bg-blue-50 text-blue-600',
    neutral: 'bg-surface-alt text-ink-600',
}

// Selo de status (corrida, PIN de segurança etc.) — sempre cor + texto juntos, nunca
// só cor, para não depender de percepção de cor como único significado.
const StatusBadge = ({ tone = 'neutral', children, className = '' }) => {
    return (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${TONES[tone] || TONES.neutral} ${className}`}>
            {children}
        </span>
    )
}

export default StatusBadge
