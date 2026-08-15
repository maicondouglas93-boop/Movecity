jest.mock('../../services/asaas.service', () => ({
    getPayment: jest.fn(),
    refundPayment: jest.fn(),
    deletePayment: jest.fn(),
}));

jest.setTimeout(120000);

const userModel = require('../../models/user.model');
const paymentModel = require('../../models/payment.model');
const rideModel = require('../../models/ride.model');
const promotionModel = require('../../models/promotion.model');
const promotionUsageModel = require('../../models/promotionUsage.model');
const cancellationReconciliationModel = require('../../models/cancellationReconciliation.model');
const { createUser } = require('../factories/user.factory');
const { createRide } = require('../factories/ride.factory');
const { createParcel } = require('../factories/parcel.factory');
const asaasService = require('../../services/asaas.service');
const {
    reconcileRideCancellation,
    reconcileParcelCancellation,
    handleAsaasRefundEvent,
} = require('../../services/cancellationReconciliation.service');

async function createPromotionUsage({ ride, user, discountAmount = 10 }) {
    const promotion = await promotionModel.create({
        code: `CANCEL${Date.now()}`,
        title: 'Cupom cancelamento',
        value: discountAmount,
        discountType: 'fixed',
        startDate: new Date(Date.now() - 60_000),
        status: 'active',
        currentBudgetUsed: discountAmount,
        metrics: { uses: 1, totalDiscountGiven: discountAmount },
    });
    const usage = await promotionUsageModel.create({
        promotionId: promotion._id,
        userId: user._id,
        rideId: ride._id,
        discountAmount,
    });
    return { promotion, usage };
}

describe('COR-1007 — reconciliação financeira de cancelamento', () => {
    beforeEach(async () => {
        await cancellationReconciliationModel.syncIndexes();
        asaasService.getPayment.mockReset();
        asaasService.refundPayment.mockReset();
        asaasService.deletePayment.mockReset();
    });

    it('20 solicitações concorrentes devolvem wallet e promoção exatamente uma vez', async () => {
        const user = await createUser({ walletBalance: 20 });
        const ride = await createRide({
            user: user._id,
            status: 'requested',
            fare: 40,
            finalPrice: 30,
            paymentMethod: 'carteira',
            walletAmountUsed: 30,
            walletAmountDebited: 30,
            paymentStatus: 'paid',
        });
        await paymentModel.create({
            rideId: ride._id,
            userId: user._id,
            amount: 30,
            method: 'carteira',
            status: 'approved',
        });
        const { promotion, usage } = await createPromotionUsage({ ride, user });

        const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => (
            reconcileRideCancellation({
                rideId: ride._id,
                actor: 'passenger',
                userId: user._id,
                reason: 'mudança de planos',
            })
        )));

        expect(attempts.some((attempt) => attempt.status === 'fulfilled')).toBe(true);
        expect(attempts
            .filter((attempt) => attempt.status === 'rejected')
            .every((attempt) => attempt.reason.code === 'CANCELLATION_IN_PROGRESS')).toBe(true);

        // Replay depois da conclusão também é sucesso e não reaplica nenhum efeito.
        const replay = await reconcileRideCancellation({
            rideId: ride._id,
            actor: 'passenger',
            userId: user._id,
            reason: 'mudança de planos',
        });
        expect(replay.status).toBe('cancelled');

        const [persistedUser, persistedPayment, persistedPromotion, persistedUsage, reconciliations] = await Promise.all([
            userModel.findById(user._id),
            paymentModel.findOne({ rideId: ride._id }),
            promotionModel.findById(promotion._id),
            promotionUsageModel.findById(usage._id),
            cancellationReconciliationModel.find({ subjectType: 'ride', subjectId: ride._id }),
        ]);
        expect(persistedUser.walletBalance).toBe(50);
        expect(persistedPayment.status).toBe('refunded');
        expect(persistedPromotion.currentBudgetUsed).toBe(0);
        expect(persistedPromotion.metrics.uses).toBe(0);
        expect(persistedPromotion.metrics.totalDiscountGiven).toBe(0);
        expect(persistedUsage.reversedAt).toBeTruthy();
        expect(reconciliations).toHaveLength(1);
        expect(reconciliations[0]).toMatchObject({
            status: 'completed',
            walletRefundAmount: 30,
            promotionReversed: true,
            paymentEffect: 'refunded',
        });
    });

    it('falha intermediária reverte status, wallet, pagamento e promoção; retry conclui', async () => {
        const user = await createUser({ walletBalance: 5 });
        const ride = await createRide({
            user: user._id,
            status: 'requested',
            fare: 25,
            finalPrice: 20,
            paymentMethod: 'carteira',
            walletAmountUsed: 20,
            walletAmountDebited: 20,
        });
        await paymentModel.create({
            rideId: ride._id,
            userId: user._id,
            amount: 20,
            method: 'carteira',
            status: 'approved',
        });
        const { promotion, usage } = await createPromotionUsage({ ride, user, discountAmount: 5 });
        const failure = jest.spyOn(promotionModel, 'updateOne').mockRejectedValueOnce(new Error('injected failure'));

        await expect(reconcileRideCancellation({
            rideId: ride._id,
            actor: 'passenger',
            userId: user._id,
        })).rejects.toMatchObject({ code: 'CANCELLATION_RETRY_REQUIRED' });
        failure.mockRestore();

        const [unchangedRide, unchangedUser, unchangedPayment, unchangedPromotion, unchangedUsage, pending] = await Promise.all([
            rideModel.findById(ride._id),
            userModel.findById(user._id),
            paymentModel.findOne({ rideId: ride._id }),
            promotionModel.findById(promotion._id),
            promotionUsageModel.findById(usage._id),
            cancellationReconciliationModel.findOne({ subjectType: 'ride', subjectId: ride._id }),
        ]);
        expect(unchangedRide.status).toBe('requested');
        expect(unchangedUser.walletBalance).toBe(5);
        expect(unchangedPayment.status).toBe('approved');
        expect(unchangedPromotion.currentBudgetUsed).toBe(5);
        expect(unchangedUsage.reversedAt).toBeNull();
        expect(pending.status).toBe('retry_required');

        const completed = await reconcileRideCancellation({
            rideId: ride._id,
            actor: 'passenger',
            userId: user._id,
        });
        expect(completed.status).toBe('cancelled');
        expect((await userModel.findById(user._id)).walletBalance).toBe(25);
        expect((await cancellationReconciliationModel.findById(pending._id)).attempts).toBe(2);
    });

    it('falha externa mantém corrida ativa e retry consulta o Asaas antes de solicitar estorno', async () => {
        const user = await createUser();
        const ride = await createRide({
            user: user._id,
            status: 'requested',
            fare: 40,
            finalPrice: 40,
            paymentMethod: 'pix',
            paymentStatus: 'paid',
        });
        await paymentModel.create({
            rideId: ride._id,
            userId: user._id,
            amount: 40,
            method: 'pix',
            status: 'approved',
            gateway: 'asaas',
            gatewayTransactionId: 'pay_asaas_1',
        });
        asaasService.getPayment.mockRejectedValueOnce(new Error('Asaas unavailable'));

        await expect(reconcileRideCancellation({
            rideId: ride._id,
            actor: 'passenger',
            userId: user._id,
        })).rejects.toMatchObject({ code: 'CANCELLATION_RETRY_REQUIRED' });
        expect((await rideModel.findById(ride._id)).status).toBe('requested');

        asaasService.getPayment.mockResolvedValueOnce({
            id: 'pay_asaas_1',
            status: 'RECEIVED',
            refunds: [],
        });
        asaasService.refundPayment.mockResolvedValueOnce({
            id: 'pay_asaas_1',
            status: 'REFUND_REQUESTED',
            refunds: [{ status: 'PENDING', value: 40 }],
        });
        const cancelled = await reconcileRideCancellation({
            rideId: ride._id,
            actor: 'passenger',
            userId: user._id,
        });
        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.cancellationReconciliationStatus).toBe('external_pending');
        expect(asaasService.getPayment).toHaveBeenCalledTimes(2);
        expect(asaasService.refundPayment).toHaveBeenCalledTimes(1);
        expect((await paymentModel.findOne({ rideId: ride._id })).status).toBe('refund_pending');

        await expect(handleAsaasRefundEvent({
            eventId: 'evt_refund_1',
            eventName: 'PAYMENT_REFUNDED',
            payment: {
                id: 'pay_asaas_1',
                status: 'REFUNDED',
                refunds: [{ status: 'DONE', value: 40 }],
            },
        })).resolves.toBe(true);
        await expect(handleAsaasRefundEvent({
            eventId: 'evt_refund_1',
            eventName: 'PAYMENT_REFUNDED',
            payment: { id: 'pay_asaas_1', status: 'REFUNDED' },
        })).resolves.toBe(true);

        const reconciliation = await cancellationReconciliationModel
            .findOne({ subjectType: 'ride', subjectId: ride._id })
            .select('+gatewayEventIds');
        expect(reconciliation.status).toBe('completed');
        expect(reconciliation.gatewayEventIds).toEqual(['evt_refund_1']);
        expect((await paymentModel.findOne({ rideId: ride._id })).status).toBe('refunded');
    });

    test.each([
        ['passenger', 'requested'],
        ['system', 'scheduled'],
        ['admin', 'started'],
    ])('matriz ator=%s cancela status=%s pelo mesmo ledger', async (actor, status) => {
        const user = await createUser();
        const ride = await createRide({ user: user._id, status, paymentMethod: 'cash' });
        const cancelled = await reconcileRideCancellation({
            rideId: ride._id,
            actor,
            userId: actor === 'passenger' ? user._id : undefined,
        });
        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.cancelledBy).toBe(actor);
        expect(await cancellationReconciliationModel.countDocuments({
            subjectType: 'ride',
            subjectId: ride._id,
            status: 'completed',
        })).toBe(1);
    });

    it('cancelamento de encomenda cria um único ledger sem inventar estorno', async () => {
        const user = await createUser();
        const parcel = await createParcel({ user: user._id, status: 'awaiting_provider' });

        const first = await reconcileParcelCancellation({
            parcelId: parcel._id,
            actor: 'passenger',
            userId: user._id,
        });
        const replay = await reconcileParcelCancellation({
            parcelId: parcel._id,
            actor: 'passenger',
            userId: user._id,
        });
        expect(first.status).toBe('cancelled');
        expect(replay.status).toBe('cancelled');

        const reconciliations = await cancellationReconciliationModel.find({
            subjectType: 'parcel',
            subjectId: parcel._id,
        });
        expect(reconciliations).toHaveLength(1);
        expect(reconciliations[0]).toMatchObject({
            status: 'completed',
            walletRefundAmount: 0,
            promotionReversed: false,
            paymentEffect: 'cancelled',
        });
        expect(asaasService.getPayment).not.toHaveBeenCalled();
    });
});
