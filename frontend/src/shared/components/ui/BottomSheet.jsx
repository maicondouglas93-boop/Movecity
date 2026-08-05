import React, { useEffect, useRef } from 'react'

/**
 * Painel inferior padrão.
 * - Sempre montado no DOM; visibilidade via translate.
 * - Altura automática pelo conteúdo (tudo visível, sem snap/expansão).
 * - Fechamento pela alça quando onClose é passado.
 */
const BottomSheet = ({ open, onClose, children, className = '', zIndexClass = 'z-modal' }) => {
    const sheetRef = useRef(null)

    useEffect(() => {
        const node = sheetRef.current
        if (!node) return

        // Correção a11y: ao fechar, evita "Blocked aria-hidden…" enquanto o foco
        // ainda está dentro do painel. React 18 não tipa `inert` como prop.
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
                px-4 pt-2 pb-[env(safe-area-inset-bottom,12px)]
                transition-transform duration-300 ease-out
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
                    className="w-full flex justify-center py-1.5"
                >
                    <span className="w-10 h-1.5 bg-line rounded-full" />
                </button>
            )}
            {children}
        </div>
    )
}

export default BottomSheet
