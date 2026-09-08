import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { DRIVER_OVERLAY_BACK } from '@/shared/services/driverOverlayBack'

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'

// open=false mantém os filhos montados (ex.: recibo/mutation da finalização).
export default function DriverOperationalDialog({ title, children, onClose, busy = false, open = true, closeLabel = 'Recolher atendimento' }) {
    const titleId = useId()
    const dialogRef = useRef(null)
    const closeRef = useRef(null)
    closeRef.current = busy ? null : onClose

    useEffect(() => {
        if (!open) return undefined
        const previous = document.activeElement
        const dialog = dialogRef.current
        dialog.focus()
        const close = event => {
            event.preventDefault()
            closeRef.current?.()
        }
        const keydown = event => {
            if (event.key === 'Escape') return close(event)
            if (event.key !== 'Tab') return
            const items = [...dialog.querySelectorAll(FOCUSABLE)].filter(node => !node.closest('[hidden], [inert], [aria-hidden="true"]'))
            const first = items[0]
            const last = items.at(-1)
            if (!first) { event.preventDefault(); dialog.focus(); return }
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                event.preventDefault(); last.focus()
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
                event.preventDefault(); first.focus()
            }
        }
        const containFocus = event => {
            if (!dialog.contains(event.target)) dialog.focus()
        }
        window.addEventListener(DRIVER_OVERLAY_BACK, close)
        document.addEventListener('keydown', keydown)
        document.addEventListener('focusin', containFocus)
        return () => {
            window.removeEventListener(DRIVER_OVERLAY_BACK, close)
            document.removeEventListener('keydown', keydown)
            document.removeEventListener('focusin', containFocus)
            // Shell retira inert no mesmo commit; microtask evita focar área bloqueada.
            queueMicrotask(() => {
                if (document.querySelector('[data-driver-dialog]')) return
                if (previous?.isConnected && !previous.closest('[inert], [hidden]')) previous.focus?.()
            })
        }
    }, [open])

    return createPortal(
        <div data-driver-dialog={open ? '' : undefined} hidden={!open} className={`${open ? 'flex' : 'hidden'} fixed inset-0 z-[100] items-end justify-center bg-black/40 pt-[max(1rem,env(safe-area-inset-top))]`}>
            <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
                className="w-full max-w-xl max-h-full min-h-0 flex flex-col rounded-t-3xl bg-surface shadow-floating outline-none pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2">
                    <h2 id={titleId} className="font-semibold text-ink-900">{title}</h2>
                    <button type="button" onClick={onClose} disabled={busy} aria-label={closeLabel}
                        className="min-h-[44px] min-w-[44px] rounded-panel text-ink-900 disabled:opacity-40">
                        <i className="ri-arrow-down-s-line text-2xl" aria-hidden="true" />
                    </button>
                </div>
                <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
            </section>
        </div>, document.body,
    )
}
