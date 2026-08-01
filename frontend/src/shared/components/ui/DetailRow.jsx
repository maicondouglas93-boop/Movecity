import React from 'react'

// Linha "ícone + título/subtítulo (+ conteúdo à direita)" — a estrutura mais repetida
// do app (LocationSearchPanel, ConfirmRide, LookingForDriver, WaitingForDriver,
// Activity...), cada uma escrita à mão com pequenas variações. Renderiza <button>
// quando clicável (em vez de <div onClick>) para dar foco de teclado de graça —
// corrige o achado de acessibilidade item 7 do relatório de UX.
const DetailRow = ({
    icon,
    iconColor = 'text-brand-500',
    title,
    subtitle,
    trailing,
    onClick,
    className = '',
    ...rest
}) => {
    const Tag = onClick ? 'button' : 'div'

    return (
        <Tag
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            className={`w-full flex items-center gap-4 py-3 text-left ${onClick ? 'active:bg-surface-alt transition-colors cursor-pointer' : ''} ${className}`}
            {...rest}
        >
            {icon && (
                <i className={`${icon} ${iconColor} text-xl flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center`} aria-hidden="true" />
            )}
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900 text-[15px] truncate">{title}</p>
                {subtitle && <p className="text-sm text-ink-400 truncate">{subtitle}</p>}
            </div>
            {trailing && <div className="flex-shrink-0">{trailing}</div>}
        </Tag>
    )
}

export default DetailRow
