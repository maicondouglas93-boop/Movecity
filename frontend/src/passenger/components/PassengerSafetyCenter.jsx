import { useMemo, useState } from 'react'
import api from '@/shared/services/axios'
import Button from '@/shared/components/ui/Button'
import DriverIdentityCard from '@/shared/components/DriverIdentityCard'
import { useToast } from '@/shared/contexts/ToastContext'
import { getAccessToken } from '@/shared/services/session'
import { personName, vehicleSummary } from '@/shared/utils/identity'
import { copyTextToClipboard } from '@/shared/utils/clipboard'

const statusLabel = {
    accepted: 'Motorista confirmado',
    going_to_pickup: 'Motorista a caminho',
    arrived: 'Motorista chegou',
    waiting_passenger: 'Aguardando embarque',
    started: 'Corrida em andamento',
}

const shortAddress = (value) => String(value || '').split(',')[0] || 'Destino não informado'

const PassengerSafetyCenter = ({ ride, captainLocation }) => {
    const [open, setOpen] = useState(false)
    const [showReport, setShowReport] = useState(false)
    const [reportMessage, setReportMessage] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [sharing, setSharing] = useState(false)
    const [confirmEmergency, setConfirmEmergency] = useState(false)
    const { addToast } = useToast()

    const sharePayload = useMemo(() => {
        if (!ride) return null
        const captainName = personName(ride.captain) || 'motorista não identificado'
        const vehicle = vehicleSummary(ride.captain, ride.vehicleType)
        const reference = String(ride._id || '').slice(-6).toUpperCase()
        const location = captainLocation
            || (ride.captain?.location?.ltd != null && ride.captain?.location?.lng != null
                ? { lat: ride.captain.location.ltd, lng: ride.captain.location.lng }
                : null)
        const locationUrl = location?.lat != null && location?.lng != null
            ? `https://maps.google.com/?q=${location.lat},${location.lng}`
            : null
        const details = [
            `Estou em uma corrida MoveCity (#${reference}).`,
            `Motorista: ${captainName}.`,
            vehicle.plate ? `Placa: ${vehicle.plate}.` : null,
            vehicle.line ? `Veículo: ${vehicle.line}.` : null,
            `Destino: ${shortAddress(ride.destination)}.`,
            `Situação: ${statusLabel[ride.status] || 'corrida ativa'}.`,
            locationUrl ? `Localização atual do veículo: ${locationUrl}` : null,
        ].filter(Boolean).join(' ')

        return { title: 'Minha corrida MoveCity', text: details }
    }, [ride, captainLocation])

    const shareRide = async () => {
        if (!sharePayload) return
        setSharing(true)
        try {
            const response = await api.post('/rides/share', { rideId: ride._id }, {
                headers: { Authorization: `Bearer ${getAccessToken('user')}` },
            })
            const rawUrl = response.data?.url
            const trackingUrl = rawUrl ? new URL(rawUrl, window.location.origin).toString() : null
            const payload = {
                ...sharePayload,
                text: trackingUrl
                    ? `${sharePayload.text} Acompanhe as atualizações: ${trackingUrl}`
                    : sharePayload.text,
                ...(trackingUrl ? { url: trackingUrl } : {}),
            }
            if (navigator.share) {
                await navigator.share(payload)
                return
            }
            await copyTextToClipboard(payload.text)
            addToast('Link de acompanhamento copiado para compartilhar.', 'success')
        } catch (err) {
            if (err?.name !== 'AbortError') {
                addToast('Não foi possível compartilhar. Tente novamente.', 'error')
            }
        } finally {
            setSharing(false)
        }
    }

    const submitReport = async () => {
        const message = reportMessage.trim()
        if (message.length < 10) {
            addToast('Descreva o problema com pelo menos 10 caracteres.', 'error')
            return
        }
        setSubmitting(true)
        try {
            await api.post('/support/tickets', {
                category: 'ride_issue',
                subject: 'Alerta de segurança durante corrida',
                message,
                rideId: ride?._id,
            }, {
                headers: { Authorization: `Bearer ${getAccessToken('user')}` },
            })
            setReportMessage('')
            setShowReport(false)
            addToast('Problema registrado. O suporte recebeu os dados da corrida.', 'success')
        } catch (err) {
            addToast(err.response?.data?.message || 'Não foi possível registrar o problema.', 'error')
        } finally {
            setSubmitting(false)
        }
    }

    if (!ride) return null

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="min-h-[44px] px-3 rounded-full border border-line bg-surface text-sm font-semibold text-ink-700 flex items-center justify-center gap-2"
                aria-label="Abrir central de segurança"
            >
                <i className="ri-shield-check-fill text-brand-600" aria-hidden="true" />
                Segurança
            </button>

            {open && (
                <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-surface px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl">
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Central de segurança</p>
                                <h2 className="text-xl font-bold text-ink-900">Ajuda durante a corrida</h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setOpen(false); setShowReport(false); setConfirmEmergency(false) }}
                                aria-label="Fechar central de segurança"
                                className="h-11 w-11 rounded-full bg-surface-alt text-ink-600 flex items-center justify-center"
                            >
                                <i className="ri-close-line text-xl" aria-hidden="true" />
                            </button>
                        </div>

                        <div className="rounded-panel border border-line bg-surface-alt p-3">
                            <DriverIdentityCard captain={ride.captain} vehicleTypeFallback={ride.vehicleType} compact />
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded-lg bg-surface p-2.5">
                                    <p className="text-ink-400">Corrida</p>
                                    <p className="font-bold text-ink-900">#{String(ride._id || '').slice(-6).toUpperCase()}</p>
                                </div>
                                <div className="rounded-lg bg-surface p-2.5">
                                    <p className="text-ink-400">Situação</p>
                                    <p className="font-bold text-ink-900">{statusLabel[ride.status] || 'Ativa'}</p>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-3">
                            <button
                                type="button"
                                onClick={shareRide}
                                disabled={sharing}
                                className="min-h-[72px] rounded-panel border border-brand-200 bg-brand-50 px-3 text-sm font-semibold text-brand-700 flex flex-col items-center justify-center gap-1"
                            >
                                <i className={`${sharing ? 'ri-loader-4-line animate-spin' : 'ri-share-forward-fill'} text-xl`} aria-hidden="true" />
                                {sharing ? 'Criando link…' : 'Compartilhar acompanhamento'}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowReport((value) => !value); setConfirmEmergency(false) }}
                                className="min-h-[72px] rounded-panel border border-line bg-surface-alt px-3 text-sm font-semibold text-ink-700 flex flex-col items-center justify-center gap-1"
                            >
                                <i className="ri-alarm-warning-fill text-xl text-amber-600" aria-hidden="true" />
                                Reportar problema
                            </button>
                        </div>

                        {showReport && (
                            <div className="mt-3 rounded-panel border border-line p-3">
                                <label htmlFor="safety-report" className="text-sm font-semibold text-ink-900">O que aconteceu?</label>
                                <textarea
                                    id="safety-report"
                                    value={reportMessage}
                                    onChange={(event) => setReportMessage(event.target.value)}
                                    rows={3}
                                    maxLength={1000}
                                    placeholder="Descreva o problema. Os dados da corrida serão anexados."
                                    className="mt-2 w-full resize-none rounded-panel border border-line p-3 text-base text-ink-900 outline-none focus:border-brand-500"
                                />
                                <Button onClick={submitReport} loading={submitting} className="mt-2 !min-h-[44px] !text-sm">
                                    Enviar para o suporte
                                </Button>
                            </div>
                        )}

                        <div className="mt-4 rounded-panel border border-danger-500/30 bg-danger-50 p-3">
                            <div className="flex gap-3 items-start">
                                <i className="ri-phone-fill text-danger-600 text-xl mt-0.5" aria-hidden="true" />
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-danger-600">Emergência imediata</p>
                                    <p className="text-xs text-ink-600 mt-0.5">Em situação de risco, ligue para a Polícia Militar.</p>
                                </div>
                            </div>
                            {!confirmEmergency ? (
                                <button
                                    type="button"
                                    onClick={() => { setConfirmEmergency(true); setShowReport(false) }}
                                    className="mt-3 min-h-[44px] w-full rounded-panel border border-danger-500 text-sm font-bold text-danger-600"
                                >
                                    Ligar para emergência
                                </button>
                            ) : (
                                <div className="mt-3 flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setConfirmEmergency(false)}
                                        className="min-h-[44px] flex-1 rounded-panel bg-surface text-sm font-semibold text-ink-600"
                                    >
                                        Voltar
                                    </button>
                                    <a
                                        href="tel:190"
                                        className="min-h-[44px] flex-1 rounded-panel bg-danger-600 text-sm font-bold text-white flex items-center justify-center"
                                    >
                                        Ligar 190
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}

export default PassengerSafetyCenter
