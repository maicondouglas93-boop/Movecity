import React, { useEffect, useRef } from 'react'

// Painel deslizante padrão — sempre montado no DOM, só alterna visibilidade via
// classe (mesmo padrão que já existe em Home.jsx e que vale manter: abrir um painel
// fica instantâneo, sem custo de montar/desmontar a árvore — ver §13 do relatório
// de UX). Fechamento sempre pela alça no topo, unificando os dois padrões que
// coexistiam hoje (alça vs. ícone de X — item 13 do relatório).
const BottomSheet = ({ open, onClose, children, className = '', zIndexClass = 'z-modal' }) => {
    const sheetRef = useRef(null)

    useEffect(() => {
        const node = sheetRef.current
        if (!node) return

        // Correção a11y (2026-08-03): ao fechar, o botão clicado ainda tem foco enquanto
        // o painel ganha aria-hidden — o Chrome avisa "Blocked aria-hidden on an element
        // because its descendant retained focus". `inert` tira o painel da ordem de
        // foco; o blur cobre o intervalo da animação. React 18 não tipa `inert` como
        // prop, então aplica no DOM.
        node.inert = !open
        if (!open) {
            const active = document.activeElement
            if (active && node.contains(active) && typeof active.blur === 'function') {
                active.blur()
            }
        }
    }, [open])

    return (
        <div
            ref={sheetRef}
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
