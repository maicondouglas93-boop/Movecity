import React from 'react'
import Button from './Button'

// Generaliza o padrão "ícone + título + descrição" que já existia copiado à mão em
// Coupons/Favorites/Cards/Scheduled/Wallet.jsx (Sprint 4 da auditoria de integração).
// variant='error' usa tom vermelho e pode ter um botão de tentar de novo — hoje nenhuma
// tela distinguia "sem dados" de "não consegui carregar" com um retry de verdade.
const EmptyState = ({
    icon = 'ri-inbox-line',
    title,
    description,
    variant = 'empty',
    actionLabel,
    onAction,
}) => {
    const isError = variant === 'error'

    return (
        <div className="flex flex-col items-center text-center py-12 px-6">
            <div className={`h-16 w-16 rounded-full flex items-center justify-center mb-4 ${isError ? 'bg-danger-50' : 'bg-surface-alt'}`}>
                <i className={`${icon} text-3xl ${isError ? 'text-danger-500' : 'text-ink-400'}`} aria-hidden="true" />
            </div>
            <h4 className="text-ink-900 font-semibold text-lg mb-1">{title}</h4>
            {description && <p className="text-sm text-ink-400 max-w-[260px]">{description}</p>}
            {actionLabel && onAction && (
                <Button variant="secondary" fullWidth={false} onClick={onAction} className="mt-5 px-6">
                    {actionLabel}
                </Button>
            )}
        </div>
    )
}

export default EmptyState
