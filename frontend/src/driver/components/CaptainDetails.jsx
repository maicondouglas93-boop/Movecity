import React, { useContext, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { LocationRefContext } from '@/shared/contexts/LocationContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { useToast } from '@/shared/contexts/ToastContext'
import api from '@/shared/services/axios'
import {
    requestLocationPermission,
    syncTrackingLifecycle,
} from '@/shared/platform/location.service'
import { openDriverAppSettings } from '@/shared/platform/driverPermissions.service'
import { hasActiveService, resolveServiceKind } from '@/shared/services/captainLocationSync'
import { isNativePlatform } from '@/shared/platform/platform'
import DriverPermissionsPanel from '@/driver/components/DriverPermissionsPanel'
import { formatBRL } from '@/shared/utils/currency'

const PANEL_BG = 'bg-[#0B3D2E]'
const ACCENT_GOLD = 'text-amber-300'

const CaptainDetails = ({ children = null }) => {
    const { captain, setCaptain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)
    // Auditoria de performance (2026-08-08, P1): LocationRefContext, não
    // LocationContext — este componente só lê locationError (muda raríssimo, só
    // pro banner de "sem GPS"), não userLocation. Sem essa separação, o card
    // inteiro (ganhos, ações rápidas, sempre visível na Home) re-renderizava a
    // cada fix de GPS por nada.
    const { locationError } = useContext(LocationRefContext)
    const { captainRide, captainParcel } = useContext(RideContext)
    const { addToast } = useToast()
    const navigate = useNavigate()
    const [summary, setSummary] = useState(null)
    const [loadingSummary, setLoadingSummary] = useState(true)

    // Hooks sempre antes de return condicional (auditoria UX 2026-08-02).
    const [isOnline, setIsOnline] = useState(captain?.isOnline || false)
    const [loadingToggle, setLoadingToggle] = useState(false)

    const fetchSummary = async () => {
        try {
            const response = await api.get('/captains/summary')
            setSummary(response.data)
        } catch (err) {
            console.error('Error fetching captain summary:', err)
        } finally {
            setLoadingSummary(false)
        }
    }

    useEffect(() => {
        fetchSummary()

        const handleSummaryUpdated = () => {
            fetchSummary()
        }

        if (socket) {
            socket.on('summary-updated', handleSummaryUpdated)
        }

        return () => {
            if (socket) {
                socket.off('summary-updated', handleSummaryUpdated)
            }
        }
    }, [socket])

    useEffect(() => {
        if (captain?.isOnline != null) setIsOnline(captain.isOnline)
    }, [captain?.isOnline])

    if (!captain) return null

    const toggleOnline = async () => {
        if (captain.approvalStatus !== 'aprovado') {
            addToast('Você não pode ficar online até que seu cadastro seja aprovado.', 'error')
            return
        }

        const nextOnline = !isOnline
        // Pedir GPS ao ficar ONLINE (não no GO — GO é corrida presencial).
        // Ajustes avançados (segundo plano, bateria e OEM) ficam no painel de
        // permissões. Não empilhamos diálogos do Android ao tocar em ONLINE.
        if (nextOnline) {
            const perm = await requestLocationPermission()
            if (!perm.granted) {
                addToast(
                    'Precisamos da localização para você ficar online e receber serviços.',
                    'error'
                )
                if (isNativePlatform()) {
                    addToast('Ative a localização nas configurações do app se o pedido não aparecer.', 'info')
                }
                return
            }
        }

        setLoadingToggle(true)
        try {
            const response = await api.post('/captains/toggle-online', {
                isOnline: nextOnline,
            })
            const updated = response.data.captain
            setIsOnline(updated.isOnline)
            setCaptain((prev) => (prev ? { ...prev, ...updated } : updated))
            if (import.meta.env.DEV) {
                console.log('[DriverStatus]', updated.isOnline ? 'ONLINE' : 'OFFLINE')
            }
            const active = hasActiveService({ captainRide, captainParcel })
            try {
                const fgs = await syncTrackingLifecycle({
                    isOnline: updated.isOnline,
                    hasActiveTrip: active,
                    serviceKind: resolveServiceKind({ captainRide, captainParcel }) || 'ride',
                })
                if (updated.isOnline && fgs?.started === false) {
                    addToast(
                        fgs?.reason === 'no_location_permission'
                            ? 'Online, mas a localização está bloqueada. Revise o aviso de permissões.'
                            : 'Online, mas o rastreamento em segundo plano ainda não iniciou. Revise o aviso de permissões.',
                        'info'
                    )
                }
            } catch (fgsErr) {
                console.warn('[DriverStatus] FGS após toggle:', fgsErr?.message || fgsErr)
            }
        } catch (error) {
            console.error('Error toggling online status:', error)
            addToast(error.response?.data?.message || 'Erro ao alterar status online', 'error')
        } finally {
            setLoadingToggle(false)
        }
    }

    const formatOnlineTime = (totalSeconds) => {
        if (!totalSeconds) return '0m'
        const h = Math.floor(totalSeconds / 3600)
        const m = Math.floor((totalSeconds % 3600) / 60)
        if (h > 0) return `${h}h${m}m`
        return `${m}m`
    }

    const formatMoney = formatBRL

    const openHelp = () => {
        const wa = String(import.meta.env.VITE_SUPPORT_WHATSAPP || '').replace(/\D/g, '')
        if (wa) {
            window.open(`https://wa.me/${wa}`, '_blank', 'noopener,noreferrer')
            return
        }
        navigate('/captain/profile')
        addToast('Abra o perfil ou fale com o suporte pelo WhatsApp configurado.', 'info')
    }

    // Créditos zerados desligam o motorista do despacho. Ele continua "online" e nada na
    // tela dizia isso — só a tela Carteira, que ele teria que abrir por conta própria.
    // Ficava esperando corrida que nunca vinha, achando que o app quebrou.
    const creditsBlocked = captain?.canReceiveRides === false

    const statusTitle = creditsBlocked
        ? 'Sem créditos'
        : isOnline && locationError
            ? 'Online, sem GPS'
            : isOnline
                ? 'Você está online'
                : 'Você está offline'

    const statusSubtitle = creditsBlocked
        ? 'Recarregue para voltar a receber corridas'
        : isOnline && locationError
            ? 'Ative a localização para receber solicitações'
            : isOnline
                ? 'Disponível para receber solicitações'
                : 'Fique online para receber solicitações'

    const bannerClass = creditsBlocked || (isOnline && locationError)
        ? 'bg-danger-600'
        : isOnline
            ? PANEL_BG
            : 'bg-ink-900'

    const quickActions = [
        { label: 'Carteira', icon: 'ri-wallet-3-line', onClick: () => navigate('/captain-wallet') },
        { label: 'Histórico', icon: 'ri-history-line', onClick: () => navigate('/captain/rides') },
        { label: 'Ganhos', icon: 'ri-bar-chart-box-line', onClick: () => navigate('/captain/earnings') },
        { label: 'Ajuda', icon: 'ri-question-line', onClick: openHelp },
    ]

    return (
        <div className="flex flex-col gap-4">
            {creditsBlocked && (
                <div className="flex flex-col gap-2 bg-danger-50 border border-danger-500/20 text-danger-600 text-xs font-semibold px-3 py-2 rounded-2xl">
                    <div className="flex items-center gap-2">
                        <i className="ri-wallet-3-line text-base" aria-hidden="true" />
                        Seus créditos acabaram — você não está recebendo corridas.
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate('/captain-wallet')}
                        className="self-start underline font-bold"
                    >
                        Recarregar créditos
                    </button>
                </div>
            )}
            {isOnline && locationError && (
                <div className="flex flex-col gap-2 bg-danger-50 border border-danger-500/20 text-danger-600 text-xs font-semibold px-3 py-2 rounded-2xl">
                    <div className="flex items-center gap-2">
                        <i className="ri-map-pin-off-line text-base" aria-hidden="true" />
                        Sem sinal de GPS — você pode não estar recebendo corridas.
                    </div>
                    {isNativePlatform() && (
                        <button
                            type="button"
                            onClick={() => openDriverAppSettings()}
                            className="self-start underline font-bold"
                        >
                            Abrir configurações do app
                        </button>
                    )}
                </div>
            )}

            <DriverPermissionsPanel />

            {/* Status online */}
            <div className={`${bannerClass} text-white rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 shadow-raised`}>
                <div className="min-w-0">
                    <h3 className="font-bold text-[15px] flex items-center gap-2">
                        <span
                            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                isOnline && !locationError
                                    ? 'bg-brand-500 animate-pulse'
                                    : isOnline
                                        ? 'bg-white/70'
                                        : 'bg-white/40'
                            }`}
                            aria-hidden="true"
                        />
                        <span className="truncate">{statusTitle}</span>
                    </h3>
                    <p className="text-[12px] text-white/80 mt-0.5 font-medium truncate">
                        {statusSubtitle}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={toggleOnline}
                    disabled={loadingToggle || captain.approvalStatus !== 'aprovado'}
                    className={`flex-shrink-0 px-4 py-2.5 rounded-full font-bold text-sm transition-all active:scale-95 ${
                        isOnline
                            ? 'bg-white text-[#0B3D2E]'
                            : 'bg-brand-500 text-white'
                    } ${(loadingToggle || captain.approvalStatus !== 'aprovado') ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                    {loadingToggle ? '…' : isOnline ? 'Ficar Offline' : 'Ficar Online'}
                </button>
            </div>

            {children}

            {/* Seus ganhos */}
            <div className={`${PANEL_BG} text-white rounded-2xl p-4 shadow-raised`}>
                <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="font-bold text-base">Seus ganhos</h3>
                    <button
                        type="button"
                        onClick={() => navigate('/captain/earnings')}
                        className="text-[11px] font-semibold text-white/90 border border-white/35 rounded-full px-2.5 py-1 active:bg-white/10"
                    >
                        Ver detalhes &gt;
                    </button>
                </div>

                <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-500 flex items-center gap-1.5">
                    Ganhos hoje
                    <i className="ri-eye-line text-sm" aria-hidden="true" />
                </p>
                <p className="text-3xl font-black tracking-tight mt-1">
                    {loadingSummary ? '…' : formatMoney(summary?.earnings)}
                </p>

                <div className="flex items-stretch mt-4 pt-3 border-t border-white/15">
                    <div className="flex-1 min-w-0 pr-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/55">Tempo online</p>
                        <div className="flex items-center gap-1.5 mt-1">
                            <p className="text-base font-bold truncate">
                                {loadingSummary ? '…' : formatOnlineTime(summary?.onlineTimeSeconds)}
                            </p>
                            <i className={`ri-time-line text-sm ${ACCENT_GOLD}`} aria-hidden="true" />
                        </div>
                    </div>
                    <div className="w-px bg-white/15" aria-hidden="true" />
                    <div className="flex-1 min-w-0 px-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/55">Corridas hoje</p>
                        <div className="flex items-center gap-1.5 mt-1">
                            <p className="text-base font-bold truncate">
                                {loadingSummary ? '…' : `${summary?.ridesToday || 0}`}
                            </p>
                            <i className={`ri-line-chart-line text-sm ${ACCENT_GOLD}`} aria-hidden="true" />
                        </div>
                    </div>
                    <div className="w-px bg-white/15" aria-hidden="true" />
                    <div className="flex-1 min-w-0 pl-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/55">Carteira</p>
                        <div className="flex items-center gap-1.5 mt-1">
                            <p className="text-base font-bold truncate">
                                {loadingSummary ? '…' : formatMoney(summary?.walletBalance)}
                            </p>
                            <i className={`ri-wallet-3-line text-sm ${ACCENT_GOLD}`} aria-hidden="true" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Ações rápidas */}
            <div>
                <h3 className="text-[11px] font-bold text-ink-400 uppercase tracking-wider mb-2.5 px-0.5">
                    Ações rápidas
                </h3>
                <div className="grid grid-cols-4 gap-2.5">
                    {quickActions.map((action) => (
                        <button
                            key={action.label}
                            type="button"
                            onClick={action.onClick}
                            className="flex flex-col items-center gap-1.5 bg-white border border-line rounded-2xl py-3 px-1 shadow-raised active:scale-[0.97] transition-transform"
                        >
                            <i className={`${action.icon} text-2xl text-brand-600`} aria-hidden="true" />
                            <span className="text-[11px] font-semibold text-ink-900 text-center leading-tight">
                                {action.label}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default CaptainDetails
