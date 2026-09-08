/* eslint-disable react/prop-types -- Mesma convenção dos painéis JSX de permissões, sem dependência runtime de prop-types. */
import { useContext, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { LocationRefContext } from '@/shared/contexts/LocationContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { useToast } from '@/shared/contexts/ToastContext'
import api from '@/shared/services/axios'
import { requestLocationPermission, syncTrackingLifecycle } from '@/shared/platform/location.service'
import { openDriverAppSettings } from '@/shared/platform/driverPermissions.service'
import { hasActiveService, resolveServiceKind } from '@/shared/services/captainLocationSync'
import { isNativePlatform } from '@/shared/platform/platform'
import DriverPermissionsPanel from '@/driver/components/DriverPermissionsPanel'
import DriverAvailabilityCard from '@/driver/components/DriverAvailabilityCard'
import useConnectionState from '@/shared/hooks/useConnectionState'
import { driverAvailability } from '@/driver/services/driverAvailability'
import { formatBRL } from '@/shared/utils/currency'
import { withHardTimeout } from '@/shared/utils/hardTimeout'

const CaptainDetails = ({ children = null, busy = false, assignedRide = null, onAvailabilityBusyChange }) => {
    const { captain, setCaptain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)
    const { locationRef, locationError } = useContext(LocationRefContext)
    const { captainRide, captainParcel } = useContext(RideContext)
    const { addToast } = useToast()
    const navigate = useNavigate()
    const connection = useConnectionState()
    const [summaryState, setSummaryState] = useState({ loading: true, data: null })
    const [summaryRetry, setSummaryRetry] = useState(0)
    const [loadingToggle, setLoadingToggle] = useState(false)
    const [pendingDesired, setPendingDesired] = useState(null)
    const [now, setNow] = useState(Date.now)
    const lockRef = useRef(false)
    const mountedRef = useRef(false)
    const ownerEpochRef = useRef(0)
    const currentRef = useRef(null)
    if (currentRef.current?.captain?._id !== captain?._id) ownerEpochRef.current += 1
    currentRef.current = { captain, captainRide: assignedRide || captainRide, captainParcel, busy }
    const active = hasActiveService(currentRef.current)
    useEffect(() => {
        onAvailabilityBusyChange?.(loadingToggle || pendingDesired !== null)
    }, [loadingToggle, pendingDesired, onAvailabilityBusyChange])
    useEffect(() => () => onAvailabilityBusyChange?.(false), [onAvailabilityBusyChange])
    useEffect(() => {
        mountedRef.current = true
        // Lê GPS por ref: a apresentação atualiza a cada 5s, não a cada posição.
        const tick = () => setNow(Date.now())
        const timer = setInterval(tick, 5000)
        window.addEventListener('focus', tick)
        return () => {
            mountedRef.current = false
            clearInterval(timer)
            window.removeEventListener('focus', tick)
        }
    }, [])
    useEffect(() => {
        setPendingDesired(null)
        setLoadingToggle(false)
        lockRef.current = false
    }, [captain?._id])
    useEffect(() => {
        let disposed = false
        let sequence = 0
        const epoch = ownerEpochRef.current
        setSummaryState({ loading: true, data: null })
        const fetchSummary = async () => {
            const request = ++sequence
            try {
                const response = await withHardTimeout(api.get('/captains/summary'))
                if (!disposed && epoch === ownerEpochRef.current && request === sequence) setSummaryState({ loading: false, data: response.data })
            } catch {
                if (!disposed && epoch === ownerEpochRef.current && request === sequence) setSummaryState({ loading: false, data: null })
            }
        }
        if (captain?._id) fetchSummary()
        socket?.on('summary-updated', fetchSummary)
        return () => { disposed = true; socket?.off('summary-updated', fetchSummary) }
    }, [captain?._id, socket, summaryRetry])

    const toggleOnline = async () => {
        const current = currentRef.current
        if (lockRef.current || current.busy || navigator.onLine === false) return
        const desired = pendingDesired ?? !current.captain?.isOnline
        if (desired && (current.captain?.approvalStatus !== 'aprovado' || current.captain?.isBlocked)) return
        // Trava ANTES da permissão nativa: dois toques não abrem dois pedidos.
        lockRef.current = true
        onAvailabilityBusyChange?.(true)
        setLoadingToggle(true)
        const owner = current.captain._id
        const epoch = ownerEpochRef.current
        const isCurrent = () => mountedRef.current && epoch === ownerEpochRef.current && currentRef.current.captain?._id === owner
        let submitted = false
        try {
            if (desired) {
                const permission = await requestLocationPermission()
                if (!isCurrent()) return
                if (!permission.granted) {
                    addToast('Ative a localização para ficar online e receber serviços.', 'error')
                    return
                }
            }
            if (!isCurrent() || currentRef.current.busy || hasActiveService(currentRef.current)) return
            submitted = true
            // Repetir após resposta perdida envia o MESMO estado, nunca inverte.
            const response = await withHardTimeout(api.post('/captains/toggle-online', { isOnline: desired }))
            const updated = response.data?.captain
            if (!isCurrent()) return
            if (updated?._id !== owner || updated.isOnline !== desired) throw new Error('ACK de disponibilidade inválido')
            setCaptain(prev => prev?._id === owner ? { ...prev, ...updated } : prev)
            setPendingDesired(null)
            const latest = currentRef.current
            try {
                const result = await syncTrackingLifecycle({
                    isOnline: desired, hasActiveTrip: hasActiveService(latest),
                    serviceKind: resolveServiceKind(latest) || 'ride',
                })
                if (isCurrent() && desired && result?.started === false) addToast('Disponibilidade confirmada. Revise as permissões de rastreamento em segundo plano.', 'info')
            } catch {
                if (isCurrent()) addToast('Revise as permissões de localização para manter o rastreamento.', 'info')
            }
        } catch (error) {
            if (!isCurrent()) return
            const rejected = error.response?.status >= 400 && error.response?.status < 500
            if (submitted) setPendingDesired(rejected ? null : desired)
            addToast(error.response?.data?.message || (submitted
                ? 'Não foi possível confirmar a disponibilidade. Tente confirmar novamente quando a conexão voltar.'
                : 'Não foi possível verificar a localização. Tente novamente.'), 'error')
        } finally {
            if (isCurrent()) { lockRef.current = false; setLoadingToggle(false) }
        }
    }

    if (!captain) return null
    const state = driverAvailability({ captain, active, busy, changing: loadingToggle,
        uncertain: pendingDesired !== null, ...connection, locationError, location: locationRef?.current, now })
    const { loading, data } = summaryState
    const money = value => value != null && Number.isFinite(Number(value)) ? formatBRL(value) : 'Indisponível'
    return <div className="flex flex-col gap-3">
        <DriverAvailabilityCard state={state} isOnline={captain.isOnline} loading={loadingToggle}
            uncertain={pendingDesired !== null} {...connection} onToggle={toggleOnline}
            disabled={loadingToggle || busy || active || !connection.internet || (!captain.isOnline && (captain.approvalStatus !== 'aprovado' || captain.isBlocked))}
            onResolveIssue={() => state.key === 'credits' ? navigate('/captain-wallet')
                : isNativePlatform() ? openDriverAppSettings() : addToast('Permita a localização nas configurações deste navegador e verifique o GPS do aparelho.', 'info')} />
        {children}
        <details className="rounded-xl border border-line bg-white p-3">
            <summary className="min-h-[44px] cursor-pointer text-sm font-semibold text-ink-900 py-2">
                Ganhos hoje · {loading ? 'Carregando...' : money(data?.earnings)}
            </summary>
            {data ? <div className="text-sm text-ink-700 space-y-2 pt-2">
                <p>Corridas hoje: {data.ridesToday ?? 'Indisponível'}</p>
                <p>Tempo online: {data.onlineTimeSeconds != null ? Math.floor(data.onlineTimeSeconds / 60) + ' min' : 'Indisponível'}</p>
                <p>Carteira: {money(data.walletBalance)}</p>
                <button type="button" onClick={() => navigate('/captain/earnings')} className="min-h-[44px] font-semibold underline">Ver detalhes dos ganhos</button>
            </div> : !loading && <div className="text-sm text-ink-700">
                <p>Não foi possível carregar o resumo. Seus ganhos não foram alterados.</p>
                <button type="button" onClick={() => setSummaryRetry(value => value + 1)} className="min-h-[44px] font-semibold underline">Tentar carregar resumo</button>
            </div>}
        </details>
        <DriverPermissionsPanel />
    </div>
}

export default CaptainDetails
