import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_BASE_URL } from '@/shared/services/apiBase'
import DriverIdentityCard from '@/shared/components/DriverIdentityCard'

const STATUS = {
    accepted: 'Motorista confirmado',
    going_to_pickup: 'Motorista a caminho do embarque',
    arrived: 'Motorista chegou ao embarque',
    waiting_passenger: 'Aguardando o passageiro',
    started: 'Corrida em andamento',
    finished: 'Corrida finalizada',
    cancelled: 'Corrida cancelada',
}

const SharedRideTracking = () => {
    const { token } = useParams()
    const [ride, setRide] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false
        let interval

        const load = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/rides/share/${encodeURIComponent(token)}`)
                const data = await response.json().catch(() => ({}))
                if (!response.ok) throw new Error(data.message || 'Acompanhamento indisponível.')
                if (!cancelled) {
                    setRide(data)
                    setError('')
                }
            } catch (err) {
                if (!cancelled) setError(err.message || 'Acompanhamento indisponível.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        load()
        interval = setInterval(load, 10_000)
        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [token])

    const locationUrl = ride?.location
        ? `https://maps.google.com/?q=${ride.location.lat},${ride.location.lng}`
        : null

    return (
        <div className="min-h-[100dvh] bg-surface-alt px-4 py-6">
            <main className="mx-auto w-full max-w-md">
                <div className="flex items-center gap-3 mb-6">
                    <img src="/movecity-logo.png" alt="MoveCity" className="h-12 w-12 object-contain" />
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Acompanhamento compartilhado</p>
                        <h1 className="text-xl font-bold text-ink-900">Corrida MoveCity</h1>
                    </div>
                </div>

                {loading ? (
                    <div className="rounded-panel bg-surface p-8 text-center shadow-raised border border-line">
                        <i className="ri-loader-4-line animate-spin text-3xl text-brand-600" aria-hidden="true" />
                        <p className="mt-3 text-sm text-ink-600">Carregando acompanhamento…</p>
                    </div>
                ) : error ? (
                    <div className="rounded-panel bg-surface p-6 text-center shadow-raised border border-line">
                        <i className="ri-link-unlink-m text-3xl text-danger-500" aria-hidden="true" />
                        <h2 className="mt-3 font-bold text-ink-900">Link indisponível</h2>
                        <p className="mt-1 text-sm text-ink-600">{error}</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <section className="rounded-panel border border-brand-200 bg-brand-50 p-4 shadow-raised" aria-live="polite">
                            <div className="flex items-center gap-3">
                                <span className={`h-3 w-3 rounded-full ${['finished', 'cancelled'].includes(ride.status) ? 'bg-ink-400' : 'bg-brand-500 animate-pulse'}`} />
                                <div>
                                    <p className="text-xs text-ink-500">Situação atual</p>
                                    <p className="font-bold text-ink-900">{STATUS[ride.status] || 'Atualizando corrida'}</p>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-panel border border-line bg-surface p-4 shadow-raised">
                            <DriverIdentityCard captain={ride.captain} compact />
                        </section>

                        <section className="rounded-panel border border-line bg-surface p-4 shadow-raised space-y-3">
                            <div className="flex gap-3">
                                <i className="ri-map-pin-user-fill text-brand-500" aria-hidden="true" />
                                <div className="min-w-0">
                                    <p className="text-xs text-ink-400">Partida</p>
                                    <p className="text-sm font-semibold text-ink-900">{ride.pickup || '—'}</p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <i className="ri-map-pin-2-fill text-danger-500" aria-hidden="true" />
                                <div className="min-w-0">
                                    <p className="text-xs text-ink-400">Destino</p>
                                    <p className="text-sm font-semibold text-ink-900">{ride.destination || '—'}</p>
                                </div>
                            </div>
                        </section>

                        {locationUrl && !['finished', 'cancelled'].includes(ride.status) && (
                            <a
                                href={locationUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="min-h-[48px] rounded-panel bg-brand-500 text-white font-bold flex items-center justify-center gap-2 shadow-raised"
                            >
                                <i className="ri-map-2-fill" aria-hidden="true" />
                                Ver localização atual no mapa
                            </a>
                        )}

                        <p className="text-center text-xs text-ink-400">Atualização automática a cada 10 segundos.</p>
                    </div>
                )}
            </main>
        </div>
    )
}

export default SharedRideTracking
