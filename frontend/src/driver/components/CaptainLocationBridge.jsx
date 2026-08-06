import { useContext, useEffect, useRef } from 'react'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { LocationContext } from '@/shared/contexts/LocationContext'
import { RideContext } from '@/shared/contexts/RideContext'
import { syncTrackingLifecycle } from '@/shared/platform/location.service'
import {
    emitCaptainLocation,
    hasActiveService,
    resolveLocationIntervalMs,
    resolveServiceKind,
} from '@/shared/services/captainLocationSync'

/**
 * Ponte única GPS ↔ Socket ↔ FGS para o app motorista.
 * - ONLINE (sem GO): intervalo moderado + FGS “online”
 * - Serviço ativo (corrida / encomenda / presencial pós-GO): intervalo alto + FGS do serviço
 * - OFFLINE sem serviço: para emit contínuo e FGS
 *
 * GO continua só navegando para /captain-presential — esta bridge não altera isso.
 */
export default function CaptainLocationBridge() {
    const { captain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)
    const { locationRef } = useContext(LocationContext)
    const { captainRide, captainParcel } = useContext(RideContext)
    const intervalRef = useRef(null)

    const isOnline = Boolean(captain?.isOnline)
    const active = hasActiveService({ captainRide, captainParcel })
    const serviceKind = resolveServiceKind({ captainRide, captainParcel })
    const intervalMs = resolveLocationIntervalMs({ isOnline, hasActiveTrip: active })

    // FGS: online OU serviço ativo (inclui presencial depois que a corrida existe).
    useEffect(() => {
        if (!captain?._id) return undefined
        let cancelled = false
        ;(async () => {
            if (cancelled) return
            await syncTrackingLifecycle({
                isOnline,
                hasActiveTrip: active,
                serviceKind: serviceKind || 'ride',
            })
        })()
        return () => { cancelled = true }
    }, [captain?._id, isOnline, active, serviceKind])

    // Emit periódico — só quando ONLINE ou em serviço (não amarra ao botão GO).
    useEffect(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
        }
        if (!captain?._id || intervalMs == null) return undefined

        const tick = () => {
            emitCaptainLocation({
                socket,
                location: locationRef?.current,
                captainId: captain._id,
            })
        }
        tick()
        intervalRef.current = setInterval(tick, intervalMs)

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }
    }, [captain?._id, socket, locationRef, intervalMs])

    return null
}
