// Bug: relatórios financeiros do admin (Dashboard executivo, gráficos, rankings) somam
// `$fare` (estimativa congelada na criação) para corridas já 'finished' — deveriam usar
// `$finalPrice` (valor real recalculado no fim), com fallback só pra corridas antigas
// sem finalPrice persistido. Sem acesso a um MongoDB real neste ambiente, este teste
// verifica estruturalmente que as pipelines de agregação usam a expressão correta em
// vez de '$fare' cru — evita regressão (ex.: alguém reintroduzir `$sum: '$fare'`).

function extractSumExpressions(pipeline) {
    const found = [];
    const walk = (node) => {
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (node && typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) {
                if (key === '$sum') found.push(value);
                walk(value);
            }
        }
    };
    walk(pipeline);
    return found;
}

jest.mock('../../models/ride.model', () => ({
    aggregate: jest.fn().mockResolvedValue([]),
    countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../models/user.model', () => ({}));
jest.mock('../../models/captain.model', () => ({}));

const rideModel = require('../../models/ride.model');
const reportService = require('../../services/report.service');

const CHARGED_FARE_EXPR = { $ifNull: [ '$finalPrice', '$fare' ] };

describe('report.service — relatórios financeiros usam finalPrice, não fare cru', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        rideModel.aggregate.mockResolvedValue([]);
    });

    test('getExecutiveDashboard nunca soma "$fare" cru — usa $ifNull com finalPrice', async () => {
        await reportService.getExecutiveDashboard('2026-01-01', '2026-01-31');

        const allSums = rideModel.aggregate.mock.calls.flatMap(([pipeline]) => extractSumExpressions(pipeline));
        expect(allSums).toContainEqual(CHARGED_FARE_EXPR);
        expect(allSums).not.toContain('$fare');
    });

    test('getChartsData (receita diária e por categoria) usa $ifNull com finalPrice', async () => {
        await reportService.getChartsData('2026-01-01', '2026-01-31');

        const allSums = rideModel.aggregate.mock.calls.flatMap(([pipeline]) => extractSumExpressions(pipeline));
        expect(allSums.filter((s) => JSON.stringify(s) === JSON.stringify(CHARGED_FARE_EXPR)).length).toBeGreaterThanOrEqual(2);
        expect(allSums).not.toContain('$fare');
    });

    test('getRankings (top passageiros/motoristas) usa $ifNull com finalPrice', async () => {
        await reportService.getRankings('2026-01-01', '2026-01-31');

        const allSums = rideModel.aggregate.mock.calls.flatMap(([pipeline]) => extractSumExpressions(pipeline));
        expect(allSums).toContainEqual(CHARGED_FARE_EXPR);
        expect(allSums).not.toContain('$fare');
    });
});
