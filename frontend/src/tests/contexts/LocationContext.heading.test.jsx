import React, { useContext } from 'react'
import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fase D da experiência de corrida ativa (2026-08-03): rumo a partir do GPS real.
// A Geolocation API só preenche `heading` quando o aparelho tem curso confiável — em
// desktop, parado, ou logo no primeiro fix, vem null. A câmera de navegação precisa de
// um rumo mesmo assim, e precisa que ele NÃO fique girando sozinho com o carro parado.

vi.mock('@/services/session', () => ({
    hasActiveSession: () => true,
    onSessionChanged: () => () => {},
}))

const { LocationProvider, LocationContext } = await import('@/contexts/LocationContext')

let emitPosition

const Probe = ({ onValue }) => {
    const { userLocation } = useContext(LocationContext)
    onValue(userLocation)
    return null
}

const renderProvider = () => {
    const values = []
    render(
        <LocationProvider>
            <Probe onValue={(v) => values.push(v)} />
        </LocationProvider>
    )
    return values
}

const fix = ({ lat, lng, heading = null, speed = null, accuracy = 12 }) => ({
    coords: { latitude: lat, longitude: lng, heading, speed, accuracy },
    timestamp: Date.now(),
})

describe('LocationContext — rumo e velocidade do GPS real (Fase D)', () => {
    beforeEach(() => {
        localStorage.clear()
        emitPosition = null
        vi.stubGlobal('navigator', {
            ...navigator,
            geolocation: {
                watchPosition: (onSuccess) => {
                    emitPosition = onSuccess
                    return 1
                },
                clearWatch: () => {},
            },
        })
    })

    it('repassa heading, speed e accuracy quando o GPS os fornece', () => {
        const values = renderProvider()

        act(() => emitPosition(fix({ lat: -23.55, lng: -46.63, heading: 137, speed: 12.5, accuracy: 8 })))

        const last = values[values.length - 1]
        expect(last).toMatchObject({ lat: -23.55, lng: -46.63, heading: 137, speed: 12.5, accuracy: 8 })
    })

    it('calcula o rumo pelo deslocamento quando o GPS não reporta heading', () => {
        const values = renderProvider()

        act(() => emitPosition(fix({ lat: -23.55, lng: -46.63 })))
        // ~111 m ao norte: acima do limiar de ruído, então vira rumo 0°.
        act(() => emitPosition(fix({ lat: -23.549, lng: -46.63 })))

        expect(values[values.length - 1].heading).toBeCloseTo(0, 1)
    })

    it('mantém o último rumo com o veículo parado, em vez de girar com a deriva do GPS', () => {
        const values = renderProvider()

        act(() => emitPosition(fix({ lat: -23.55, lng: -46.63 })))
        act(() => emitPosition(fix({ lat: -23.55, lng: -46.629 }))) // ~102 m a leste → 90°
        const emMovimento = values[values.length - 1].heading
        expect(emMovimento).toBeCloseTo(90, 1)

        // Parado no semáforo: deriva de ~2 m para o sul. Não pode virar rumo 180°.
        act(() => emitPosition(fix({ lat: -23.550018, lng: -46.629 })))

        expect(values[values.length - 1].heading).toBeCloseTo(emMovimento, 1)
    })

    it('prefere sempre o heading do próprio GPS ao calculado', () => {
        const values = renderProvider()

        act(() => emitPosition(fix({ lat: -23.55, lng: -46.63 })))
        act(() => emitPosition(fix({ lat: -23.549, lng: -46.63, heading: 270 })))

        expect(values[values.length - 1].heading).toBe(270)
    })

    it('persiste só lat/lng — rumo velho reabriria o app girando a câmera para o nada', () => {
        renderProvider()

        act(() => emitPosition(fix({ lat: -23.55, lng: -46.63, heading: 137, speed: 12.5 })))

        expect(JSON.parse(localStorage.getItem('lastLocation'))).toEqual({ lat: -23.55, lng: -46.63 })
    })
})
