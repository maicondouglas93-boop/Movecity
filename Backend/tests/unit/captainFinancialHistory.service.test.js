// Bug: histórico financeiro do motorista no painel admin (Finance.jsx) somava `fare`
// (estimativa congelada na criação) em vez de `finalPrice` (valor real recalculado no
// fim da corrida) — mesma classe de bug do histórico do passageiro, só que no ledger
// financeiro. getCaptainFinancialHistory já filtra status:'finished', então toda
// corrida aqui tem um finalPrice válido; ele precisa ser a fonte do `amount`.

function selectChain(resolvedValue) {
    return {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue(resolvedValue),
    };
}

jest.mock('../../models/ride.model', () => ({
    find: jest.fn(),
}));

jest.mock('../../models/payout.model', () => ({
    find: jest.fn(),
}));

// admin.service.js importa notification.service.js, que puxa notificationDispatcher
// (node-cron agendado no require — travaria o processo do teste sem isto) e
// wallet.service — nenhum dos dois é usado por getCaptainFinancialHistory.
jest.mock('../../services/notification.service', () => ({}));
jest.mock('../../services/wallet.service', () => ({}));
jest.mock('../../socket', () => ({ disconnectSocket: jest.fn() }));

const rideModel = require('../../models/ride.model');
const payoutModel = require('../../models/payout.model');
const adminService = require('../../services/admin.service');

describe('getCaptainFinancialHistory — usa finalPrice, não fare', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        payoutModel.find.mockReturnValue(selectChain([]));
    });

    test('corrida finalizada com valor final diferente da estimativa usa finalPrice no ledger', async () => {
        rideModel.find.mockReturnValue(selectChain([
            { createdAt: new Date(), fare: 44.74, finalPrice: 38.2, commissionAmount: 7.64 },
        ]));

        const history = await adminService.getCaptainFinancialHistory('captain1');

        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ type: 'ride', amount: 38.2, commission: 7.64 });
    });

    test('corrida sem finalPrice persistido (legado) cai pra fare como último recurso', async () => {
        rideModel.find.mockReturnValue(selectChain([
            { createdAt: new Date(), fare: 20, finalPrice: undefined, commissionAmount: 4 },
        ]));

        const history = await adminService.getCaptainFinancialHistory('captain1');

        expect(history[0].amount).toBe(20);
    });

    test('seleciona finalPrice explicitamente na query (não só fare/commissionAmount)', async () => {
        rideModel.find.mockReturnValue(selectChain([]));

        await adminService.getCaptainFinancialHistory('captain1');

        const selectCall = rideModel.find.mock.results[0].value.select;
        expect(selectCall).toHaveBeenCalledWith(expect.stringContaining('finalPrice'));
    });
});
