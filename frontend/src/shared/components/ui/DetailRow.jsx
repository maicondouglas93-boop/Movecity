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
    compact = false,
    className = '',
    ...rest
}) => {
    const Tag = onClick ? 'button' : 'div'

    return (
        <Tag
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            className={`w-full flex items-center text-left ${
                compact ? 'gap-2.5 py-1.5' : 'gap-4 py-3'
            } ${onClick ? 'active:bg-surface-alt transition-colors cursor-pointer' : ''} ${className}`}
            {...rest}
        >
            {icon && (
                <i
                    className={`${icon} ${iconColor} ${
                        compact ? 'text-lg min-w-[36px] min-h-[36px]' : 'text-xl min-w-[44px] min-h-[44px]'
                    } flex-shrink-0 flex items-center justify-center`}
                    aria-hidden="true"
                />
            )}
            <div className="flex-1 min-w-0">
                <p className={`font-semibold text-ink-900 truncate ${compact ? 'text-sm' : 'text-[15px]'}`}>{title}</p>
                {subtitle && (
                    <p className={`text-ink-400 truncate ${compact ? 'text-xs' : 'text-sm'}`}>{subtitle}</p>
                )}
            </div>
            {trailing && <div className="flex-shrink-0">{trailing}</div>}
        </Tag>
    )
}

export default DetailRow
