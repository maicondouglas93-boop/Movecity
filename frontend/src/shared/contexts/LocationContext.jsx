import React, { createContext, useState, useEffect, useMemo, useRef } from 'react'
import { hasActiveSession, onSessionChanged } from '@/shared/services/session'
import { computeBearing, distanceMeters } from '@/shared/services/maps/navigationMath'
import { watchPosition, clearWatch } from '@/shared/platform/location.service'

export const LocationContext = createContext()

// Auditoria de performance do app do motorista (2026-08-08, P1): LocationContext
// original empacotava { userLocation, locationRef, locationError } num objeto só,
// recriado a cada fix de GPS — qualquer consumidor de useContext(LocationContext)
// re-renderizava junto, mesmo quem só lia `locationRef` (uma ref — nunca muda de
// verdade) ou `locationError` (muda raríssimo). CaptainLocationBridge (retorna null,
// só lê locationRef dentro de um setInterval próprio) e CaptainDetails (só lê
// locationError, pra um banner de "sem GPS") são os dois casos claros: nenhum dos
// dois precisa re-renderizar a ~1x/seg. LocationRefContext expõe só essas duas
// partes, memoizado com deps [locationError] — locationRef em si já é estável
// (useRef nunca muda de identidade), então este valor só ganha referência nova
// quando locationError muda de verdade, nunca por causa de userLocation.
// LocationContext original fica intacto (mesmo formato, mesmo comportamento) para
// quem genuinamente precisa de userLocation reativo (LiveTracking, CaptainHome,
// RidePopUp, etc.).
export const LocationRefContext = createContext()

const MIN_BEARING_DISTANCE_M = 8

export const LocationProvider = ({ children }) => {
    const [userLocation, setUserLocation] = useState(() => {
        try {
            const saved = localStorage.getItem('lastLocation')
            return saved ? JSON.parse(saved) : null
        } catch {
            return null
        }
    })

    const [locationError, setLocationError] = useState(null)
    const [hasSession, setHasSession] = useState(() => hasActiveSession())

    const locationRef = useRef(userLocation)
    const lastFixRef = useRef(null)
    const lastHeadingRef = useRef(null)
    const watchHandleRef = useRef(null)

    useEffect(() => {
        return onSessionChanged(() => setHasSession(hasActiveSession()))
    }, [])

    useEffect(() => {
        if (!hasSession) return undefined

        let cancelled = false

        const handleSuccess = (position) => {
            const { latitude, longitude, heading, speed, accuracy } = position.coords
            const point = { lat: latitude, lng: longitude }

            let resolvedHeading = Number.isFinite(heading) ? heading : null
            const previous = lastFixRef.current
            if (resolvedHeading == null && previous) {
                const moved = distanceMeters(previous, point)
                if (moved != null && moved >= MIN_BEARING_DISTANCE_M) {
                    resolvedHeading = computeBearing(previous, point)
                }
            }
            if (resolvedHeading == null) resolvedHeading = lastHeadingRef.current
            if (resolvedHeading != null) lastHeadingRef.current = resolvedHeading
            lastFixRef.current = point

            const coords = {
                ...point,
                heading: resolvedHeading,
                speed: Number.isFinite(speed) ? speed : null,
                accuracy: Number.isFinite(accuracy) ? accuracy : null,
                timestamp: position.timestamp || Date.now(),
            }

            locationRef.current = coords
            setUserLocation(coords)
            setLocationError(null)

            try {
                localStorage.setItem('lastLocation', JSON.stringify(point))
            } catch (e) {
                console.error('Erro ao salvar no localStorage', e)
            }
        }

        const handleError = (error) => {
            console.error('Erro de GPS:', error)
            if (error.code === 1 || error.code === error.PERMISSION_DENIED) {
                setLocationError('Permissão de localização negada.')
            } else if (error.code === 2 || error.code === error.POSITION_UNAVAILABLE) {
                setLocationError('Não foi possível obter sua localização. Verifique se o GPS está ligado.')
            } else if (error.code === 3 || error.code === error.TIMEOUT) {
                setLocationError('Sinal de GPS demorando para responder. Tentando novamente...')
            } else {
                setLocationError(`Erro ao obter localização: ${error.message}`)
            }
        }

        ;(async () => {
            const handle = await watchPosition(handleSuccess, handleError, {
                enableHighAccuracy: true,
                maximumAge: 3000,
                timeout: 10000,
            })
            if (cancelled) {
                await clearWatch(handle)
                return
            }
            watchHandleRef.current = handle
        })()

        return () => {
            cancelled = true
            const h = watchHandleRef.current
            watchHandleRef.current = null
            if (h) clearWatch(h)
        }
    }, [hasSession])

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const refValue = useMemo(() => ({ locationRef, locationError }), [locationError])

    return (
        <LocationContext.Provider value={{ userLocation, locationRef, locationError }}>
            <LocationRefContext.Provider value={refValue}>
                {children}
            </LocationRefContext.Provider>
        </LocationContext.Provider>
    )
}
