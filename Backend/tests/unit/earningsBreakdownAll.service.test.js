// Auditoria do app do motorista (2026-08-11, P1): "Ganhos Totais" na tela do motorista
// lia captain.earnings (bruto, nunca subtrai comissão) — nunca batia com a soma dos
// cards de período (líquidos) logo abaixo, na mesma tela. getEarningsBreakdown agora
// aceita range='all' reaproveitando 100% do cálculo líquido já usado por day/week/month,
// só sem filtro de data.

jest.mock('../../models/ride.model', () => ({ find: jest.fn() }));

function findChain(rides) {
    return { sort: jest.fn().mockResolvedValue(rides) };
}

const rideModel = require('../../models/ride.model');
const captainService = require('../../services/captain.service');

describe('getEarningsBreakdown — range=all', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('soma líquido (finalPrice - commissionAmount) de todas as corridas finalizadas, sem filtro de data', async () => {
        rideModel.find.mockReturnValue(findChain([
            { _id: 'r1', updatedAt: new Date(), pickup: 'A', destination: 'B', finalPrice: 38.2, fare: 44.74, commissionAmount: 7.64 },
            { _id: 'r2', updatedAt: new Date(), pickup: 'C', destination: 'D', finalPrice: null, fare: 20, commissionAmount: 4 },
        ]));

        const result = await captainService.getEarningsBreakdown('captain1', 'all');

        // r1: 38.2 - 7.64 = 30.56 · r2: 20 - 4 = 16 → total 46.56
        expect(result.totalEarnings).toBeCloseTo(46.56, 2);
        expect(result.totalRides).toBe(2);
        expect(result.range).toBe('all');
    });

    test('não aplica filtro updatedAt na query quando range=all (diferente de day/week/month)', async () => {
        rideModel.find.mockReturnValue(findChain([]));

        await captainService.getEarningsBreakdown('captain1', 'all');

        const queryArg = rideModel.find.mock.calls[0][0];
        expect(queryArg).not.toHaveProperty('updatedAt');
        expect(queryArg).toMatchObject({ captain: 'captain1', status: 'finished' });
    });

    test('day/week/month continuam aplicando o filtro de data (sem regressão)', async () => {
        rideModel.find.mockReturnValue(findChain([]));

        await captainService.getEarningsBreakdown('captain1', 'week');

        const queryArg = rideModel.find.mock.calls[0][0];
        expect(queryArg).toHaveProperty('updatedAt');
        expect(queryArg.updatedAt.$gte).toBeInstanceOf(Date);
    });
});
