/* eslint-disable react/prop-types */
import { useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import ConnectionBanner from '@/shared/components/ui/ConnectionBanner'
import PassengerIdentityCard from '@/shared/components/PassengerIdentityCard'
import { formatBRL } from '@/shared/utils/currency'
import { paymentMethodLabel } from '@/shared/utils/ridePaymentPresentation'
import { formatManeuverDistance, maneuverIcon } from '@/shared/services/maps/navigationMath'

export default function DriverTripView({ children, ride, presentation, elapsedSec, expanded, onExpand,
    onFinish, onHelp, onCancel, canCancel, onChat, unreadCount, onReviewGps, onRetryMeter,
    navigationMode, onNavigationToggle, navInfo, mapsUrl, modalOpen }) {
    const root = useRef(null)
    useLayoutEffect(() => { root.current.inert = Boolean(modalOpen) }, [modalOpen])
    const presential = ride.source === 'driver_initiated'
    const gps = presentation.gps
    const showNavigation = navigationMode && gps.usable && !ride.destinationPending
    const hasDirections = Boolean(showNavigation && navInfo?.step)
    const phone = String(ride.user?.phone || '').trim().replace(/[()\s.-]/g, '')
    const phoneUrl = /^\+?\d{8,15}$/.test(phone) ? `tel:${phone}` : null
    const destination = ride.destinationPending ? 'Destino definido ao finalizar' : ride.destination || 'Destino indisponível'
    const elapsed = Number.isFinite(elapsedSec) ? `${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(elapsedSec % 60).padStart(2, '0')}` : 'Indisponível'
    return <div ref={root} data-driver-trip className="h-[100dvh] flex flex-col overflow-hidden bg-surface">
        <header className={`shrink-0 ${hasDirections ? 'max-h-[40%]' : 'max-h-[25%]'} min-h-0 flex flex-col pt-[env(safe-area-inset-top)] bg-surface border-b border-line`}>
            <ConnectionBanner inline />
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2">
                <Link to="/captain-home" aria-label="Voltar para a Home" className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-line">
                    <i className="ri-home-5-line text-xl" aria-hidden="true" />
                </Link>
                <button type="button" onClick={onNavigationToggle} aria-label={navigationMode ? 'Ver rota completa' : 'Voltar à navegação'} aria-pressed={navigationMode}
                    className={`min-w-[44px] min-h-[44px] rounded-xl ${navigationMode ? 'bg-brand-700 text-white' : 'border border-line'}`}>
                    <i className="ri-compass-3-line text-xl" aria-hidden="true" />
                </button>
                <button type="button" onClick={onHelp} className="min-h-[44px] rounded-xl border border-line px-3 text-sm font-semibold">Ajuda e segurança</button>
            </div>
            {hasDirections && <div className="mx-3 mb-2 rounded-xl bg-ink-900 text-white p-3 min-h-0 overflow-y-auto flex gap-3 items-start">
                <i className={`${maneuverIcon(navInfo.step.maneuver)} text-2xl shrink-0`} aria-hidden="true" />
                <div className="min-w-0">
                    {Number.isFinite(navInfo.distanceToStepM) && <p className="text-xl font-bold">{formatManeuverDistance(navInfo.distanceToStepM)}</p>}
                    <p className="text-sm break-words">{navInfo.step.instruction}</p>
                </div>
            </div>}
        </header>
        {/* O mapa mede só a área livre: barra superior/painel não cobrem sua câmera. */}
        <div data-trip-map className="relative flex-1 min-h-[15%] overflow-hidden">{children}</div>
        <section aria-label="Corrida em andamento" className={`shrink-0 ${hasDirections ? 'max-h-[45%]' : 'max-h-[60%]'} min-h-0 flex flex-col border-t border-line rounded-t-2xl bg-surface`}>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1" aria-live="off">
                    <div className="min-w-0">
                        <h1 className="text-sm font-semibold text-ink-900">{presential ? 'Corrida presencial' : 'Corrida em andamento'}</h1>
                        <p className="text-xs text-ink-600">Tempo {elapsed} · Distância {presentation.distance == null ? 'indisponível' : `${(presentation.distance / 1000).toFixed(1)} km`}</p>
                    </div>
                    {showNavigation && Number.isFinite(navInfo?.etaMinutes) && <p className="text-sm text-ink-700">Destino: cerca de {navInfo.etaMinutes} min</p>}
                </div>
                {!gps.usable && <p role="status" aria-label="Estado do GPS" className="mt-1 text-sm font-semibold text-amber-800">{gps.title}. Confira o sinal nos detalhes.</p>}
                <div className={`mt-2 rounded-xl px-3 py-2 ${['unavailable', 'read-error'].includes(presentation.source) ? 'bg-amber-50' : 'bg-brand-50'}`} aria-live="off">
                    <p className="text-xs text-ink-700">{presentation.label}</p>
                    <p data-trip-amount className={`${presential ? 'text-3xl' : 'text-2xl'} font-bold tabular-nums text-ink-900 break-words`}>
                        {presentation.amount == null ? 'Indisponível' : formatBRL(presentation.amount)}
                    </p>
                </div>
                <p role="status" aria-label="Estado da medição" className={`mt-2 text-sm ${gps.usable ? 'text-ink-700' : 'text-amber-800'}`}>
                    {gps.usable ? 'GPS recente. ' : ''}{presentation.explanation}
                </p>
                <button type="button" onClick={onExpand} aria-expanded={expanded} aria-controls="trip-details" className="min-h-[44px] mt-1 w-full text-sm font-semibold underline text-ink-900">
                    {expanded ? 'Recolher detalhes da corrida' : 'Ver detalhes da corrida e do sinal'}
                </button>
                {expanded && <div id="trip-details" className="border-t border-line pt-3 space-y-3 text-sm text-ink-700">
                    {ride.user ? <PassengerIdentityCard user={ride.user} showPhoto compact /> : <p>Passageiro presencial sem conta vinculada.</p>}
                    <p><strong>Embarque:</strong> {ride.pickup || 'Endereço indisponível'}</p>
                    <p><strong>Destino:</strong> {destination}</p>
                    <p><strong>Pagamento:</strong> {paymentMethodLabel(ride.paymentMethod)}</p>
                    <div className="rounded-xl bg-surface-alt p-3 space-y-2">
                        <p>{presentation.connectionLabel}. A conexão não substitui o GPS.</p>
                        <p>{gps.detail}</p>
                        {gps.ageMs != null && <p>Última posição: há {Math.floor(gps.ageMs / 1000)} s.</p>}
                        {!gps.usable && <button type="button" onClick={onReviewGps} className="min-h-[44px] font-semibold underline">Revisar localização</button>}
                        {presentation.source === 'read-error' && <button type="button" onClick={onRetryMeter} className="block min-h-[44px] font-semibold underline">Tentar atualizar medição</button>}
                    </div>
                    <p className="text-xs">Tempo pode contar com o veículo parado. Distância só aumenta com pontos válidos do GPS; internet e sinal de localização são coisas diferentes.</p>
                    {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-[44px] items-center font-semibold underline">Abrir destino no Google Maps</a>}
                    {phoneUrl && <a href={phoneUrl} className="flex min-h-[44px] items-center font-semibold underline">Ligar para o passageiro</a>}
                    {ride.user?._id && <button type="button" onClick={onChat} className="min-h-[44px] font-semibold underline">Abrir chat com o passageiro{unreadCount > 0 ? ` (${unreadCount > 9 ? '9+' : unreadCount})` : ''}</button>}
                    {canCancel && <button type="button" onClick={onCancel} className="block min-h-[44px] text-danger-700 font-semibold underline">Cancelar corrida iniciada por engano</button>}
                </div>}
            </div>
            <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-line bg-surface">
                <button type="button" onClick={onFinish} className="min-h-[48px] w-full rounded-xl px-3 py-2 bg-brand-700 text-white text-base font-bold">Finalizar corrida</button>
            </div>
        </section>
    </div>
}
