import { describe, expect, it } from 'vitest'
import { calculateOfflinePassengerFare, sumTrailMeters, isNightTime } from '@/shared/services/offlineRideFare'

describe('offlineRideFare', () => {
    it('soma só segmentos acima de 5 m', () => {
        const meters = sumTrailMeters([
            { lat: -20.0, lng: -41.0, capturedAt: 1 },
            { lat: -20.0, lng: -41.0, capturedAt: 2 },
            { lat: -20.01, lng: -41.0, capturedAt: 3 },
        ])
        expect(meters).toBeGreaterThan(1000)
    })

    it('calcula valor do passageiro com GPS local + km já sincronizados', () => {
        const fare = calculateOfflinePassengerFare({
            ride: {
                startedAt: Date.now() - 10 * 60 * 1000,
                actualDistance: 2000,
                fareRates: {
                    baseFare: 5,
                    perKm: 2,
                    perMinute: 0.5,
                    minimumFare: 7,
                    minDistanceIncludedKm: 0,
                    minTimeIncludedMin: 0,
                    roundingRule: 'none',
                    waitingActive: false,
                    globalTariffsTotal: 0,
                },
            },
            queuedPoints: [
                { lat: -20.0, lng: -41.0, capturedAt: 1 },
                { lat: -20.01, lng: -41.0, capturedAt: 2 },
            ],
            now: Date.now(),
        })
        expect(fare.offline).toBe(true)
        expect(fare.actualDistance).toBeGreaterThan(2000)
        expect(fare.amount).toBeGreaterThan(5)
        expect(fare.fareBreakdown.baseFare).toBe(5)
    })

    it('sem taxas congeladas não inventa preço', () => {
        expect(calculateOfflinePassengerFare({
            ride: { actualDistance: 5000 },
            queuedPoints: [],
        })).toBeNull()
    })

    // Regressão do achado P1 (auditoria de 16-17 ago): o cálculo do celular não conhecia
    // adicional noturno nem de chuva, e essas taxas nem eram enviadas ao aparelho. O app
    // mandava cobrar menos do que a finalização registraria e o motorista pagava comissão
    // sobre a diferença que nunca recebeu.
    describe('paridade com o motor de preço do servidor', () => {
        const at = (hour) => {
            const d = new Date()
            d.setHours(hour, 0, 0, 0)
            return d.getTime()
        }

        // 10 min de corrida, distância desprezível: base 10 + tempo 5 = 15 de subtotal.
        // startedAt é ancorado no `now` do próprio cenário, senão o tempo decorrido vira
        // a diferença até o relógio real da máquina e o valor explode.
        const baseRide = (now, extraRates = {}, rideExtra = {}) => ({
            startedAt: now - 10 * 60 * 1000,
            actualDistance: 1,
            fareRates: {
                baseFare: 10,
                perKm: 2,
                perMinute: 0.5,
                minimumFare: 0,
                minDistanceIncludedKm: 0,
                minTimeIncludedMin: 0,
                roundingRule: 'none',
                waitingActive: false,
                globalTariffsTotal: 0,
                ...extraRates,
            },
            ...rideExtra,
        })

        it('aplica multiplicador noturno sobre o subtotal (1.2 = +20%, não +1,2%)', () => {
            const fare = calculateOfflinePassengerFare({
                ride: baseRide(at(23), { nightActive: true, nightType: 'multiplier', nightValue: 1.2 }),
                queuedPoints: [],
                now: at(23),
            })
            // subtotal 15 + 20% = 18
            expect(fare.amount).toBeCloseTo(18, 2)
            expect(fare.fareBreakdown.nightSurcharge).toBeCloseTo(3, 2)
        })

        it('não cobra noturno fora da janela configurada', () => {
            const fare = calculateOfflinePassengerFare({
                ride: baseRide(at(14), { nightActive: true, nightType: 'multiplier', nightValue: 1.2 }),
                queuedPoints: [],
                now: at(14),
            })
            expect(fare.amount).toBeCloseTo(15, 2)
            expect(fare.fareBreakdown.nightSurcharge).toBe(0)
        })

        it('reconhece janela noturna que cruza a meia-noite', () => {
            const rates = { nightActive: true, nightStartTime: '22:00', nightEndTime: '06:00' }
            expect(isNightTime(rates, new Date(at(23)))).toBe(true)
            expect(isNightTime(rates, new Date(at(3)))).toBe(true)
            expect(isNightTime(rates, new Date(at(12)))).toBe(false)
        })

        it('soma adicional noturno de valor fixo', () => {
            const fare = calculateOfflinePassengerFare({
                ride: baseRide(at(23), { nightActive: true, nightType: 'fixed', nightValue: 4 }),
                queuedPoints: [],
                now: at(23),
            })
            expect(fare.amount).toBeCloseTo(19, 2)
        })

        it('aplica adicional de chuva percentual', () => {
            const fare = calculateOfflinePassengerFare({
                ride: baseRide(at(14), { rainActive: true, rainType: 'percent', rainValue: 20 }),
                queuedPoints: [],
                now: at(14),
            })
            expect(fare.amount).toBeCloseTo(18, 2)
        })

        it('desconta cupom depois do piso da tarifa mínima', () => {
            const fare = calculateOfflinePassengerFare({
                ride: baseRide(at(14), { minimumFare: 20 }, { discountAmount: 5 }),
                queuedPoints: [],
                now: at(14),
            })
            // subtotal 15 sobe pro piso 20, e só então o cupom de 5 desconta.
            expect(fare.amount).toBeCloseTo(15, 2)
            expect(fare.fareBreakdown.discount).toBe(5)
        })

        it('nunca deixa o cupom levar o valor abaixo de zero', () => {
            const fare = calculateOfflinePassengerFare({
                ride: baseRide(at(14), {}, { discountAmount: 999 }),
                queuedPoints: [],
                now: at(14),
            })
            expect(fare.amount).toBe(0)
        })
    })
})
