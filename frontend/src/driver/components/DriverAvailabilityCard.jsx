/* eslint-disable react/prop-types -- Mesma convenção dos painéis JSX de permissões, sem dependência runtime de prop-types. */
export default function DriverAvailabilityCard({ state, isOnline, disabled, loading, uncertain, internet, connected, onToggle, onResolveIssue }) {
    const occupied = ['occupied', 'accepting'].includes(state.key)
    return <section aria-label="Disponibilidade do motorista" className={`rounded-2xl p-4 border ${state.tone === 'available' ? 'bg-brand-50 border-brand-200' : state.tone === 'warning' ? 'bg-amber-50 border-amber-200' : 'bg-white border-line'}`}>
        <div role="status" aria-live="polite">
            <h2 className="text-base font-bold text-ink-900">{state.title}</h2>
            <p className="text-sm text-ink-700 mt-1 break-words">{state.description}</p>
        </div>
        {(!internet || !connected) && state.key !== 'reconnecting' && <p className="text-sm text-amber-800 mt-2">
            {!internet ? 'Sem internet.' : 'Conexão em tempo real interrompida.'} Sua conta continua conectada.
        </p>}
        {!occupied && <button type="button" onClick={onToggle} disabled={disabled}
            className={`mt-3 min-h-[48px] w-full rounded-xl px-4 py-3 font-bold disabled:opacity-60 ${isOnline || uncertain ? 'border border-line bg-white text-ink-900' : 'bg-brand-600 text-white'}`}>
            {loading ? 'Confirmando...' : uncertain ? 'Confirmar disponibilidade' : isOnline ? 'Ficar offline' : 'Ficar online'}
        </button>}
        {['credits', 'gps'].includes(state.key) && onResolveIssue && <button type="button" onClick={onResolveIssue}
            className="mt-2 min-h-[44px] w-full text-sm font-semibold underline text-ink-900">
            {state.key === 'credits' ? 'Conferir créditos na carteira' : 'Revisar localização'}
        </button>}
    </section>
}
