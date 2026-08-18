const promotionModel = require('../../models/promotion.model');
const promotionUsageModel = require('../../models/promotionUsage.model');
const userModel = require('../../models/user.model');
const promotionService = require('../../services/promotion.service');

const findPromotion = jest.spyOn(promotionModel, 'findOne');
const countPromotionUses = jest.spyOn(promotionUsageModel, 'countDocuments');
const findUser = jest.spyOn(userModel, 'findById');

describe('promotion.service — cupons de desconto', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('calcula desconto percentual e respeita o teto', () => {
        expect(promotionService.evaluateDiscount({
            discountType: 'percentage',
            value: 30,
            maxDiscountLimit: 10,
        }, 50)).toEqual({ discount: 10, clientPays: 40, subsidy: 10 });
    });

    test('calcula desconto fixo sem deixar o preço negativo', () => {
        expect(promotionService.evaluateDiscount({
            discountType: 'fixed',
            value: 80,
        }, 50)).toEqual({ discount: 50, clientPays: 0, subsidy: 50 });
    });

    test.each(['cashback', 'free_ride', 'referral'])('não aceita o tipo legado %s', (discountType) => {
        expect(promotionService.evaluateDiscount({ discountType, value: 20 }, 50))
            .toEqual({ discount: 0, clientPays: 50, subsidy: 0 });
    });

    test('busca exclusivamente cupons pelo código normalizado', async () => {
        findPromotion.mockResolvedValue({
            _id: 'coupon-1',
            type: 'coupon',
            code: 'MOVE10',
            status: 'active',
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            endDate: new Date('2027-01-01T00:00:00.000Z'),
            discountType: 'fixed',
            value: 10,
            currentBudgetUsed: 0,
            rules: {},
        });
        findUser.mockResolvedValue({ _id: 'user-1', totalRides: 0 });
        countPromotionUses.mockResolvedValue(0);

        const result = await promotionService.findApplicablePromotion({
            code: ' move10 ',
            userId: 'user-1',
            vehicleType: 'Moto',
            paymentMethod: 'pix',
            rideValue: 50,
        });

        expect(promotionModel.findOne).toHaveBeenCalledWith({ type: 'coupon', code: 'MOVE10' });
        expect(result).toMatchObject({ discountAmount: 10 });
    });

    test('não aplica desconto maior que o orçamento restante', async () => {
        findPromotion.mockResolvedValue({
            _id: 'coupon-2',
            type: 'coupon',
            code: 'LIMITE10',
            status: 'active',
            discountType: 'fixed',
            value: 10,
            budgetLimit: 100,
            currentBudgetUsed: 95,
            rules: {},
        });
        findUser.mockResolvedValue({ _id: 'user-1', totalRides: 0 });
        countPromotionUses.mockResolvedValue(0);

        await expect(promotionService.findApplicablePromotion({
            code: 'LIMITE10',
            userId: 'user-1',
            vehicleType: 'Moto',
            paymentMethod: 'pix',
            rideValue: 50,
        })).resolves.toEqual({ error: 'Este cupom não possui orçamento suficiente para este desconto' });
    });
});
