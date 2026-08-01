import React from 'react'

const SHADOWS = {
    flat: '',
    raised: 'shadow-raised',
    floating: 'shadow-floating',
}

// Wrapper de painel elevado — única "forma" de cartão do sistema novo, substituindo as
// variações soltas de border/rounded/shadow reescritas em cada tela (ver §0 do plano).
const Card = ({ shadow = 'flat', padding = 'p-4', className = '', children, ...rest }) => {
    return (
        <div
            className={`bg-surface border border-line rounded-panel ${padding} ${SHADOWS[shadow] || ''} ${className}`}
            {...rest}
        >
            {children}
        </div>
    )
}

export default Card
