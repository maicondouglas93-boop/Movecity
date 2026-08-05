import React, { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Painel inferior padrão.
 * - Sempre montado no DOM; visibilidade via translate (abertura instantânea).
 * - Fechamento pela alça (quando onClose é passado).
 * - Modo expandable: abre em ~35% da tela e sobe até ~80% por gesto/toque,
 *   mantendo o mapa parcialmente visível.
 */
const BottomSheet = ({
    open,
    onClose,
    children,
    className = '',
    zIndexClass = 'z-modal',
    expandable = false,
    initialSnap = 0.35,
    expandedSnap = 0.8,
}) => {
    const sheetRef = useRef(null)
    const dragRef = useRef({ startY: 0, startExpanded: false, dragging: false })
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
        if (!open) setExpanded(false)
    }, [open])

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

    const snapHeight = expanded
        ? `min(${Math.round(expandedSnap * 100)}dvh, ${Math.round(expandedSnap * 100)}%)`
        : `min(${Math.round(initialSnap * 100)}dvh, ${Math.round(initialSnap * 100)}%)`

    const onPointerDown = useCallback((e) => {
        if (!expandable) return
        dragRef.current = {
            startY: e.clientY ?? e.touches?.[0]?.clientY ?? 0,
            startExpanded: expanded,
            dragging: true,
        }
    }, [expandable, expanded])

    const onPointerMove = useCallback((e) => {
        if (!expandable || !dragRef.current.dragging) return
        const y = e.clientY ?? e.touches?.[0]?.clientY
        if (y == null) return
        const delta = dragRef.current.startY - y
        // Arrastar para cima (~48px) expande; para baixo recolhe; se já recolhido, fecha.
        if (delta > 48 && !expanded) setExpanded(true)
        if (delta < -48 && expanded) setExpanded(false)
        if (delta < -96 && !expanded && !dragRef.current.startExpanded) {
            dragRef.current.dragging = false
            onClose?.()
        }
    }, [expandable, expanded, onClose])

    const onPointerUp = useCallback(() => {
        dragRef.current.dragging = false
    }, [])

    const toggleExpand = useCallback(() => {
        if (!expandable) {
            onClose?.()
            return
        }
        setExpanded((v) => !v)
    }, [expandable, onClose])

    return (
        <div
            ref={sheetRef}
            className={`
                fixed w-full bottom-0 left-0 ${zIndexClass}
                bg-surface rounded-t-3xl shadow-floating
                px-4 pt-2 pb-[env(safe-area-inset-bottom,12px)]
                transition-[transform,height] duration-300 ease-out
                ${open ? 'translate-y-0' : 'translate-y-full invisible'}
                ${expandable ? 'flex flex-col overflow-hidden' : ''}
                ${className}
            `}
            style={expandable && open ? { height: snapHeight, maxHeight: snapHeight } : undefined}
            aria-hidden={!open}
        >
            {(onClose || expandable) && (
                <button
                    type="button"
                    onClick={toggleExpand}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onTouchStart={onPointerDown}
                    onTouchMove={onPointerMove}
                    onTouchEnd={onPointerUp}
                    aria-label={expandable ? (expanded ? 'Recolher painel' : 'Expandir painel') : 'Fechar'}
                    aria-expanded={expandable ? expanded : undefined}
                    className="w-full flex justify-center py-1.5 flex-shrink-0 touch-none"
                >
                    <span className="w-10 h-1.5 bg-line rounded-full" />
                </button>
            )}
            <div className={expandable ? 'flex-1 min-h-0 overflow-y-auto overscroll-y-contain' : undefined}>
                {children}
            </div>
        </div>
    )
}

export default BottomSheet
