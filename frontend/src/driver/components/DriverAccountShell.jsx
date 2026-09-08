import { Suspense, useLayoutEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import CaptainHeader from '@/driver/components/CaptainHeader'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'

export default function DriverAccountShell({ children, notice, modalOpen, operations }) {
    const ref = useRef(null)
    const homeRef = useRef(null)
    const secondary = useLocation().pathname !== '/captain-home'
    useLayoutEffect(() => {
        ref.current.inert = Boolean(modalOpen)
        homeRef.current.inert = secondary
    }, [modalOpen, secondary])
    return (
        <div ref={ref} data-driver-shell className="h-[100dvh] flex flex-col overflow-hidden bg-surface-alt">
            <CaptainHeader embedded interactionBlocked={modalOpen} />
            <ConnectionBanner inline />
            {notice && <div className="shrink-0 px-3 py-2 border-b border-line bg-surface">{notice}</div>}
            <div className="relative flex-1 min-h-0 isolate">
                {/* Mantém o mapa montado, mas não deixa os controles ocultos receberem foco. */}
                <div ref={homeRef} aria-hidden={secondary} className={`absolute inset-0 flex flex-col ${secondary ? 'invisible pointer-events-none' : ''}`}>
                    {children}
                </div>
                {secondary && <div className="absolute inset-0 z-panel overflow-y-auto bg-surface-alt">
                    <Suspense fallback={<p role="status" className="p-5">Carregando página...</p>}><Outlet context={operations} /></Suspense>
                </div>}
            </div>
        </div>
    )
}
