import React from 'react'

// Card de opção selecionável (categoria de veículo, método de pagamento). Estado
// "selecionado" fica visualmente resolvido (borda + fundo da marca) em vez de o
// usuário só descobrir o que escolheu na tela seguinte — achado da auditoria de UX
// sobre VehiclePanel.jsx.
const SelectableOptionCard = ({
    selected = false,
    icon,
    title,
    subtitle,
    trailing,
    onClick,
    className = '',
    ...rest
}) => {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={selected}
            className={`
                w-full flex items-center gap-4 p-3 rounded-panel border-2 text-left
                transition-colors active:scale-[0.98]
                ${selected ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface-alt'}
                ${className}
            `}
            {...rest}
        >
            {icon && <div className="flex-shrink-0">{icon}</div>}
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900 truncate">{title}</p>
                {subtitle && <p className="text-sm text-ink-400 truncate">{subtitle}</p>}
            </div>
            {trailing && <div className="flex-shrink-0 text-right">{trailing}</div>}
        </button>
    )
}

export default SelectableOptionCard
