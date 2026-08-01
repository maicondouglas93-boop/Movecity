import React from 'react'

// Painel deslizante padrão — sempre montado no DOM, só alterna visibilidade via
// classe (mesmo padrão que já existe em Home.jsx e que vale manter: abrir um painel
// fica instantâneo, sem custo de montar/desmontar a árvore — ver §13 do relatório
// de UX). Fechamento sempre pela alça no topo, unificando os dois padrões que
// coexistiam hoje (alça vs. ícone de X — item 13 do relatório).
const BottomSheet = ({ open, onClose, children, className = '', zIndexClass = 'z-modal' }) => {
    return (
        <div
            className={`
                fixed w-full bottom-0 left-0 ${zIndexClass}
                bg-surface rounded-t-3xl shadow-floating
                px-4 pt-3 pb-[env(safe-area-inset-bottom,16px)]
                transition-transform duration-300
                ${open ? 'translate-y-0' : 'translate-y-full invisible'}
                ${className}
            `}
            aria-hidden={!open}
        >
            {onClose && (
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar"
                    className="w-full flex justify-center py-2 -mt-1"
                >
                    <span className="w-10 h-1.5 bg-line rounded-full" />
                </button>
            )}
            {children}
        </div>
    )
}

export default BottomSheet
