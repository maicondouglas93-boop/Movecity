const mockCalculateFare = jest.fn();

jest.mock('../../services/pricingEngine.service', () => ({
    calculateFare: (...args) => mockCalculateFare(...args),
}));

const {
    calculateLiveRideFare,
    getElapsedSeconds,
    getRideOptionals,
} = require('../../services/liveRideFare.service');

describe('valor da corrida em tempo real', () => {
    beforeEach(() => {
        mockCalculateFare.mockReset();
        mockCalculateFare.mockResolvedValue({ finalFare: 27.45 });
    });

    it('usa distância e tempo correntes com a tarifa congelada da corrida', async () => {
        const startedAt = new Date('2026-08-12T12:00:00.000Z');
        const pricingSnapshot = { category: { name: 'car' } };
        const ride = {
            status: 'started',
            startedAt,
            vehicleType: 'car',
            paymentMethod: 'carteira',
            source: 'passenger_requested',
            pricingSnapshot,
            waitTimeSeconds: 90,
            optionals: [ { type: 'porta_malas', price: 3 }, 'aceita_animais' ],
        };

        const result = await calculateLiveRideFare({
            ride,
            actualDistance: 4250,
            now: new Date('2026-08-12T12:10:00.000Z').getTime(),
        });

        expect(mockCalculateFare).toHaveBeenCalledWith({
            distance: 4250,
            time: 600,
            vehicleType: 'car',
            paymentMethod: 'pix',
            configSnapshot: pricingSnapshot,
            serviceKind: 'ride',
            waitTimeSeconds: 90,
            optionals: { porta_malas: true, aceita_animais: true },
        });
        expect(result).toMatchObject({
            amount: 27.45,
            actualDistance: 4250,
            elapsedSeconds: 600,
            currency: 'BRL',
        });
    });

    it('usa a regra presencial para corrida iniciada pelo motorista', async () => {
        await calculateLiveRideFare({
            ride: {
                status: 'ongoing',
                createdAt: new Date('2026-08-12T12:00:00.000Z'),
                vehicleType: 'moto',
                paymentMethod: 'cash',
                source: 'driver_initiated',
                actualDistance: 1200,
            },
            now: new Date('2026-08-12T12:05:00.000Z').getTime(),
        });

        expect(mockCalculateFare).toHaveBeenCalledWith(expect.objectContaining({
            distance: 1200,
            time: 300,
            serviceKind: 'presential',
        }));
    });

    it('não calcula preço fora de uma corrida iniciada', async () => {
        await expect(calculateLiveRideFare({
            ride: { status: 'accepted' },
            actualDistance: 100,
        })).resolves.toBeNull();
        expect(mockCalculateFare).not.toHaveBeenCalled();
    });

    it('normaliza tempo e opcionais inválidos sem produzir valores negativos', () => {
        expect(getElapsedSeconds({ startedAt: 'invalid-date' }, Date.now())).toBe(0);
        expect(getRideOptionals({ optionals: [ null, {}, 'bagagem' ] })).toEqual({ bagagem: true });
    });
});
