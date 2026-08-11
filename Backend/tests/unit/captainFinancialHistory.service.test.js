// Bug original: histórico financeiro do motorista no painel admin (Finance.jsx) somava
// `fare` (estimativa congelada na criação) em vez de `finalPrice` (valor real
// recalculado no fim da corrida). getCaptainFinancialHistory foi reescrita (auditoria de
// UX, 2026-08-10) pra ler do ledger real (transactionModel) em vez de interlaçar
// rideModel+payoutModel — o lançamento 'ride_payment' já é criado com
// finalFare = claimed.finalPrice || claimed.fare em ride.service.js#confirmRidePayment,
// então o ledger nunca sofreu desse bug; a leitura direta de rideModel.fare que sofria
// não existe mais nesta função.

function paginatedQuery(resolvedValue) {
    return {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(resolvedValue),
    };
}

jest.mock('../../models/transaction.model', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
}));

// admin.service.js importa notification.service.js, que puxa notificationDispatcher
// (node-cron agendado no require — travaria o processo do teste sem isto) e
// wallet.service — nenhum dos dois é usado por getCaptainFinancialHistory.
jest.mock('../../services/notification.service', () => ({}));
jest.mock('../../services/wallet.service', () => ({}));
jest.mock('../../socket', () => ({ disconnectSocket: jest.fn() }));

const transactionModel = require('../../models/transaction.model');
const adminService = require('../../services/admin.service');

describe('getCaptainFinancialHistory — ledger real (transactionModel), paginado', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('devolve os lançamentos do motorista já com o amount gravado no ledger (sem recalcular fare/finalPrice aqui)', async () => {
        transactionModel.find.mockReturnValue(paginatedQuery([
            { type: 'ride_payment', amount: 38.2, captainId: 'captain1' },
        ]));
        transactionModel.countDocuments.mockResolvedValue(1);

        const result = await adminService.getCaptainFinancialHistory('captain1');

        expect(result.transactions).toHaveLength(1);
        expect(result.transactions[0]).toMatchObject({ type: 'ride_payment', amount: 38.2 });
        expect(result.total).toBe(1);
        expect(transactionModel.find).toHaveBeenCalledWith({ captainId: 'captain1' });
    });

    test('pagina com skip/limit derivados de page/limit', async () => {
        transactionModel.find.mockReturnValue(paginatedQuery([]));
        transactionModel.countDocuments.mockResolvedValue(45);

        const result = await adminService.getCaptainFinancialHistory('captain1', 2, 20);

        const query = transactionModel.find.mock.results[0].value;
        expect(query.skip).toHaveBeenCalledWith(20);
        expect(query.limit).toHaveBeenCalledWith(20);
        expect(result.pages).toBe(3);
    });
});
