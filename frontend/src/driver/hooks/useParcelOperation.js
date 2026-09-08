import { useCallback, useEffect, useRef, useState } from 'react'
import { getSessionOwnerId } from '@/shared/services/session'
import { withHardTimeout } from '@/shared/utils/hardTimeout'
import { onAppActive } from '@/shared/platform/appLifecycle.service'

export const PARCEL_NEXT = {
    provider_accepted: 'going_to_pickup', going_to_pickup: 'arrived_pickup',
    arrived_pickup: 'collected', collected: 'in_transit', in_transit: 'arrived_destination',
}
const statuses = [...Object.keys(PARCEL_NEXT), 'arrived_destination', 'delivered', 'finished']
export const validDriverParcel = p => Boolean(p && typeof p._id === 'string' && p._id.trim() && statuses.includes(p.status))

// No queue: physical hand-off, PIN and settlement require a server acknowledgement.
// A timeout does not cancel the native transport; consult current state before retrying.
export default function useParcelOperation({ owner, initial, sync, publish, leave, socket }) {
    const [parcel, setParcel] = useState(() => validDriverParcel(initial) ? initial : null)
    const [busy, setBusy] = useState(false)
    const [confirmed, setConfirmed] = useState(false)
    const [error, setError] = useState('')
    const current = useRef(parcel)
    const mounted = useRef(false)
    const lock = useRef(false)
    const options = useRef({ sync, publish, leave })
    options.current = { sync, publish, leave }
    const alive = useCallback(() => mounted.current && getSessionOwnerId('captain') === owner, [owner])
    const apply = next => { current.current = next; setParcel(next); options.current.publish(next) }

    const refresh = useCallback(async () => {
        if (!alive() || lock.current) return
        lock.current = true
        setBusy(true)
        setConfirmed(false)
        try {
            const next = await withHardTimeout(options.current.sync())
            if (!alive()) return
            if (next === null) {
                current.current = null
                setParcel(null)
                options.current.publish(null)
                options.current.leave()
                return
            }
            if (!validDriverParcel(next)) throw new Error('UNKNOWN_PARCEL')
            current.current = next
            setParcel(next)
            options.current.publish(next)
            setConfirmed(true)
            setError('')
        } catch {
            if (alive()) setError(current.current
                ? 'Não foi possível consultar a encomenda. Os dados anteriores foram mantidos; consulte novamente antes de continuar.'
                : 'Não foi possível consultar a encomenda. Consulte novamente antes de continuar.')
        } finally {
            lock.current = false
            if (alive()) setBusy(false)
        }
    }, [alive])

    useEffect(() => {
        mounted.current = true
        refresh()
        const visible = () => { if (document.visibilityState === 'visible') refresh() }
        const cancelled = event => { if (event?.parcelId === current.current?._id) refresh() }
        window.addEventListener('online', refresh)
        document.addEventListener('visibilitychange', visible)
        socket?.on('connect', refresh)
        socket?.on('parcel-cancelled', cancelled)
        const offActive = onAppActive(refresh)
        return () => {
            mounted.current = false
            window.removeEventListener('online', refresh)
            document.removeEventListener('visibilitychange', visible)
            socket?.off('connect', refresh)
            socket?.off('parcel-cancelled', cancelled)
            offActive?.()
        }
    }, [refresh, socket])

    const run = async ({ request, accepts, done = false }) => {
        const snapshot = current.current
        if (!alive() || lock.current || !confirmed || !validDriverParcel(snapshot)) return
        if (navigator.onLine === false) {
            setConfirmed(false)
            setError('Sem conexão. Nenhuma confirmação foi enviada. O PIN e a entrega precisam da confirmação do servidor.')
            return
        }
        lock.current = true
        setBusy(true)
        setError('')
        try {
            const result = await withHardTimeout(request(snapshot))
            if (!alive()) return
            if (!accepts(result, snapshot)) throw new Error('INVALID_ACK')
            if (done) {
                apply(null)
                options.current.leave()
            } else {
                apply(result)
                setConfirmed(true)
            }
            return result
        } catch (err) {
            if (!alive()) return
            setConfirmed(false)
            const reason = err.response?.status === 400 && typeof err.response?.data?.message === 'string'
                ? `${err.response.data.message}. ` : ''
            setError(`${reason}A confirmação não foi obtida. Consulte o estado no servidor antes de tentar novamente; não repita a cobrança.`)
        } finally {
            lock.current = false
            if (alive()) setBusy(false)
        }
    }
    return { parcel, busy, confirmed, error, refresh, run }
}
