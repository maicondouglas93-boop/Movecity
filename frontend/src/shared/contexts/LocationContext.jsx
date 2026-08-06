import React, { createContext, useState, useEffect, useRef } from 'react'
import { hasActiveSession, onSessionChanged } from '@/shared/services/session'
import { computeBearing, distanceMeters } from '@/shared/services/maps/navigationMath'
import { watchPosition, clearWatch } from '@/shared/platform/location.service'

export const LocationContext = createContext()

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

    return (
        <LocationContext.Provider value={{ userLocation, locationRef, locationError }}>
            {children}
        </LocationContext.Provider>
    )
}
