import React from 'react'

const VARIANTS = {
    primary: 'bg-brand-500 hover:bg-brand-600 text-white disabled:bg-brand-500/50',
    secondary: 'bg-surface-alt hover:bg-line/60 text-ink-900 border border-line',
    ghost: 'bg-transparent hover:bg-surface-alt text-ink-600',
    danger: 'bg-danger-50 hover:bg-danger-50/70 text-danger-600 border border-danger-500/20',
    // Vermelho sólido — reservado pra ações destrutivas irreversíveis de fato (excluir
    // conta), não pra "cancelar corrida" e afins, que usam o `danger` suave acima.
    dangerSolid: 'bg-danger-500 hover:bg-danger-600 text-white disabled:bg-danger-500/40',
}

// Botão padrão do app — resolve dois problemas achados na auditoria de UX:
// 1) cada tela reescrevia as classes do zero (fonte da inconsistência de sombra/raio);
// 2) ações assíncronas importantes (buscar tarifa, pedir corrida) não tinham nenhum
//    estado de carregamento, parecendo travadas — `loading` cobre isso por padrão.
const Button = ({
    variant = 'primary',
    loading = false,
    disabled = false,
    fullWidth = true,
    className = '',
    children,
    ...rest
}) => {
    const isDisabled = disabled || loading

    return (
        <button
            type="button"
            disabled={isDisabled}
            className={`
                ${fullWidth ? 'w-full' : ''}
                min-h-[48px] rounded-panel font-semibold text-base
                flex items-center justify-center gap-2
                transition-all active:scale-[0.97]
                disabled:cursor-not-allowed disabled:active:scale-100
                ${VARIANTS[variant] || VARIANTS.primary}
                ${className}
            `}
            {...rest}
        >
            {loading && <i className="ri-loader-4-line animate-spin text-lg" aria-hidden="true" />}
            {children}
        </button>
    )
}

export default Button
