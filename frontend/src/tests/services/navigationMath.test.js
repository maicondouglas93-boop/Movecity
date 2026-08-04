import { describe, it, expect } from 'vitest'
import {
    cameraCenterForFollow,
    computeBearing,
    distanceMeters,
    dynamicZoom,
    formatManeuverDistance,
    lerpAngle,
    maneuverIcon,
    metersPerPixel,
    normalizeAngle,
    offsetPosition,
    pickNextStep,
    shortestAngleDelta,
} from '@/services/maps/navigationMath'

// Fase D da experiência de corrida ativa (2026-08-03). Estes testes cobrem o
// comportamento da navegação que NÃO dá para verificar só olhando o mapa: o rumo
// calculado quando o GPS não reporta heading, a câmera que joga o veículo para o terço
// inferior, o zoom que reage à velocidade e a próxima manobra que nunca volta atrás.

const SP = { lat: -23.5505, lng: -46.6333 } // Praça da Sé, São Paulo

describe('computeBearing', () => {
    it('aponta para o norte quando o próximo ponto está acima', () => {
        expect(computeBearing(SP, { lat: SP.lat + 0.01, lng: SP.lng })).toBeCloseTo(0, 1)
    })

    it('aponta para o leste quando o próximo ponto está à direita', () => {
        expect(computeBearing(SP, { lat: SP.lat, lng: SP.lng + 0.01 })).toBeCloseTo(90, 1)
    })

    it('aponta para o sul e para o oeste nas direções opostas', () => {
        expect(computeBearing(SP, { lat: SP.lat - 0.01, lng: SP.lng })).toBeCloseTo(180, 1)
        expect(computeBearing(SP, { lat: SP.lat, lng: SP.lng - 0.01 })).toBeCloseTo(270, 1)
    })

    it('devolve sempre 0..360, nunca negativo (a câmera não aceita rumo negativo)', () => {
        const bearing = computeBearing(SP, { lat: SP.lat + 0.01, lng: SP.lng - 0.01 })
        expect(bearing).toBeGreaterThanOrEqual(0)
        expect(bearing).toBeLessThan(360)
    })

    it('devolve null sem os dois pontos', () => {
        expect(computeBearing(null, SP)).toBeNull()
        expect(computeBearing(SP, null)).toBeNull()
    })
})

describe('distanceMeters', () => {
    it('mede ~1113 m para 0,01° de latitude', () => {
        const d = distanceMeters(SP, { lat: SP.lat + 0.01, lng: SP.lng })
        expect(d).toBeGreaterThan(1100)
        expect(d).toBeLessThan(1120)
    })

    it('é zero para o mesmo ponto', () => {
        expect(distanceMeters(SP, { ...SP })).toBeCloseTo(0, 5)
    })
})

describe('offsetPosition', () => {
    it('avança exatamente a distância pedida na direção pedida', () => {
        const ahead = offsetPosition(SP, 90, 500)
        expect(distanceMeters(SP, ahead)).toBeCloseTo(500, 0)
        expect(computeBearing(SP, ahead)).toBeCloseTo(90, 1)
    })

    it('desloca só a longitude indo para o leste', () => {
        const ahead = offsetPosition(SP, 90, 500)
        expect(ahead.lat).toBeCloseTo(SP.lat, 4)
        expect(ahead.lng).toBeGreaterThan(SP.lng)
    })
})

describe('shortestAngleDelta / lerpAngle', () => {
    it('cruza o norte pelo caminho curto em vez de dar a volta', () => {
        // De 350° para 10° são 20° à direita, não 340° à esquerda.
        expect(shortestAngleDelta(350, 10)).toBe(20)
        expect(shortestAngleDelta(10, 350)).toBe(-20)
    })

    it('interpola cruzando o norte sem passar pelo sul', () => {
        expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 5)
    })

    it('mantém o resultado normalizado em 0..360', () => {
        expect(normalizeAngle(-90)).toBe(270)
        expect(lerpAngle(350, 10, 1)).toBeCloseTo(10, 5)
    })
})

describe('cameraCenterForFollow (veículo no terço inferior)', () => {
    const zoom = 17
    const viewportHeightPx = 800

    it('mira à frente do veículo, na direção do movimento', () => {
        const center = cameraCenterForFollow({ position: SP, heading: 0, zoom, viewportHeightPx })
        // Rumo norte: o centro da câmera fica ao norte do veículo, então o veículo
        // aparece ABAIXO do centro da tela — que é o objetivo.
        expect(center.lat).toBeGreaterThan(SP.lat)
        // Comparado pelo menor caminho angular: 0° e 359,999° são o mesmo rumo.
        expect(Math.abs(shortestAngleDelta(computeBearing(SP, center), 0))).toBeLessThan(0.1)
    })

    it('desloca ~18% da altura da tela, convertida para metros no zoom atual', () => {
        const center = cameraCenterForFollow({ position: SP, heading: 90, zoom, viewportHeightPx })
        const expected = metersPerPixel(SP.lat, zoom) * viewportHeightPx * 0.18
        expect(distanceMeters(SP, center)).toBeCloseTo(expected, 0)
    })

    it('acompanha a direção: virando para leste, a câmera vira junto', () => {
        const center = cameraCenterForFollow({ position: SP, heading: 90, zoom, viewportHeightPx })
        expect(computeBearing(SP, center)).toBeCloseTo(90, 1)
    })

    it('afasta menos em zoom alto do que em zoom baixo (o offset é em pixels, não em metros fixos)', () => {
        const perto = cameraCenterForFollow({ position: SP, heading: 0, zoom: 19, viewportHeightPx })
        const longe = cameraCenterForFollow({ position: SP, heading: 0, zoom: 15, viewportHeightPx })
        expect(distanceMeters(SP, perto)).toBeLessThan(distanceMeters(SP, longe))
    })

    it('sem rumo conhecido, devolve a própria posição em vez de deslocar para o norte por acidente', () => {
        expect(cameraCenterForFollow({ position: SP, heading: null, zoom, viewportHeightPx })).toBe(SP)
        expect(cameraCenterForFollow({ position: SP, heading: 0, zoom, viewportHeightPx: 0 })).toBe(SP)
    })
})

describe('dynamicZoom', () => {
    it('aproxima parado e afasta em velocidade de rodovia', () => {
        const parado = dynamicZoom({ speedMps: 0 })
        const rodovia = dynamicZoom({ speedMps: 30 }) // 108 km/h
        expect(parado).toBe(18)
        expect(rodovia).toBe(16)
        expect(parado).toBeGreaterThan(rodovia)
    })

    it('nunca é fixo: cada faixa de velocidade tem seu zoom, sempre decrescente', () => {
        const zooms = [0, 8, 14, 20, 30].map(speedMps => dynamicZoom({ speedMps }))
        for (let i = 1; i < zooms.length; i++) {
            expect(zooms[i]).toBeLessThanOrEqual(zooms[i - 1])
        }
        expect(new Set(zooms).size).toBeGreaterThan(1)
    })

    it('aproxima ao chegar perto de uma manobra, mesmo em velocidade de rodovia', () => {
        expect(dynamicZoom({ speedMps: 30, distanceToManeuverM: 100 })).toBe(18)
        expect(dynamicZoom({ speedMps: 30, distanceToManeuverM: 900 })).toBe(16)
    })

    it('trata velocidade ausente como parado (GPS sem velocímetro não pode afastar a câmera)', () => {
        expect(dynamicZoom({ speedMps: null })).toBe(18)
        expect(dynamicZoom({})).toBe(18)
    })
})

describe('pickNextStep', () => {
    const steps = [
        { instruction: 'Siga em frente', maneuver: 'straight', location: { lat: -23.5505, lng: -46.6333 } },
        { instruction: 'Vire à direita', maneuver: 'turn-right', location: { lat: -23.5450, lng: -46.6333 } },
        { instruction: 'Você chegou', maneuver: 'destination', location: { lat: -23.5450, lng: -46.6280 } },
    ]

    it('devolve a manobra à frente e a distância até ela', () => {
        const longe = { lat: -23.5500, lng: -46.6333 }
        const result = pickNextStep(steps, longe)
        expect(result.step.instruction).toBe('Siga em frente')
        expect(result.distanceMeters).toBeGreaterThan(35)
    })

    it('avança para a próxima manobra ao chegar no ponto da atual', () => {
        const emCima = { lat: -23.5505, lng: -46.6333 }
        const result = pickNextStep(steps, emCima)
        expect(result.step.instruction).toBe('Vire à direita')
        expect(result.index).toBe(1)
    })

    it('nunca volta para uma manobra já cumprida, mesmo com salto de GPS para trás', () => {
        // Motorista já está no passo 2; um fix ruim o joga de volta perto do passo 0.
        const saltoParaTras = { lat: -23.5505, lng: -46.6333 }
        const result = pickNextStep(steps, saltoParaTras, 2)
        expect(result.index).toBe(2)
        expect(result.step.instruction).toBe('Você chegou')
    })

    it('sinaliza fim da rota quando todas as manobras foram cumpridas', () => {
        const noDestino = { lat: -23.5450, lng: -46.6280 }
        const result = pickNextStep(steps, noDestino, 2)
        expect(result.step).toBeNull()
        expect(result.index).toBe(3)
    })

    it('não quebra sem passos (provider que não devolve manobras)', () => {
        expect(pickNextStep([], SP)).toEqual({ index: 0, step: null, distanceMeters: null })
        expect(pickNextStep(null, SP).step).toBeNull()
    })
})

describe('formatManeuverDistance', () => {
    it('usa metros arredondados perto e quilômetros longe', () => {
        expect(formatManeuverDistance(183)).toBe('180 m')
        expect(formatManeuverDistance(2340)).toBe('2.3 km')
    })

    it('nunca mostra "0 m" (distância abaixo da precisão do GPS vira o mínimo legível)', () => {
        expect(formatManeuverDistance(3)).toBe('10 m')
    })

    it('devolve vazio para valor inválido', () => {
        expect(formatManeuverDistance(null)).toBe('')
        expect(formatManeuverDistance(-5)).toBe('')
    })
})

describe('maneuverIcon', () => {
    it('mapeia as manobras conhecidas para ícones distintos', () => {
        expect(maneuverIcon('turn-left')).not.toBe(maneuverIcon('turn-right'))
        expect(maneuverIcon('destination')).toBe('ri-map-pin-2-fill')
    })

    it('cai em "siga em frente" para manobra desconhecida', () => {
        expect(maneuverIcon('manobra-que-nao-existe')).toBe('ri-arrow-up-line')
        expect(maneuverIcon(undefined)).toBe('ri-arrow-up-line')
    })
})
