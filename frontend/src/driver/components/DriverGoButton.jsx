import { useNavigate } from 'react-router-dom'

// eslint-disable-next-line react/prop-types -- Convenção dos componentes JSX do motorista, sem prop-types em runtime.
export default function DriverGoButton({ disabled = false }) {
    const navigate = useNavigate()
    return <div className="flex flex-col items-center py-3 gap-2">
        <button
            type="button"
            onClick={() => navigate('/captain-presential')}
            disabled={disabled}
            aria-label="GO — Iniciar uma corrida presencial"
            className="relative w-16 h-16 shrink-0 rounded-full bg-brand-500 text-white flex items-center justify-center shadow-floating enabled:active:scale-95 motion-safe:enabled:animate-go-pulse disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700"
        >
            {!disabled && <span
                className="absolute inset-0 rounded-full bg-brand-500 motion-safe:animate-go-ring pointer-events-none"
                aria-hidden="true"
            />}
            <span className="relative text-lg font-black tracking-wide">GO</span>
        </button>
        <p className="text-xs font-semibold text-ink-600">Iniciar uma corrida</p>
    </div>
}
