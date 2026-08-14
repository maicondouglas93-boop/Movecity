jest.mock('../../models/ride.model', () => ({}));
jest.mock('../../services/admin.service', () => ({ logAction: jest.fn() }));

const { OFFER_HIGHLIGHT_TTL_MS, computeOfferExpiresAt } = require('../../config/offerPolicy');
const { manualDispatchState } = require('../../services/manualRideDispatch.service');

describe('Política de relançamento de corrida manual', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');

    it('libera o relançamento da mesma corrida depois que a oferta expira', () => {
        const ride = {
            _id: 'ride-1',
            source: 'admin',
            status: 'requested',
            captain: null,
            createdAt: new Date(now.getTime() - OFFER_HIGHLIGHT_TTL_MS - 1),
        };

        expect(manualDispatchState(ride, now)).toMatchObject({
            rideId: 'ride-1',
            status: 'requested',
            captainId: null,
            canRelaunch: true,
        });
    });

    it('uma nova tentativa reinicia o prazo usando dispatchLastAttemptAt', () => {
        const dispatchLastAttemptAt = new Date(now.getTime() - 5_000);
        const ride = {
            _id: 'ride-2',
            source: 'admin',
            status: 'requested',
            captain: null,
            createdAt: new Date(now.getTime() - 20 * 60_000),
            dispatchLastAttemptAt,
        };

        const state = manualDispatchState(ride, now);
        expect(state.canRelaunch).toBe(false);
        expect(state.offerExpiresAt).toEqual(computeOfferExpiresAt(ride));
        expect(state.offerExpiresAt.getTime()).toBe(dispatchLastAttemptAt.getTime() + OFFER_HIGHLIGHT_TTL_MS);
    });

    it('não permite relançar se um motorista já aceitou', () => {
        const ride = {
            _id: 'ride-3',
            source: 'admin',
            status: 'accepted',
            captain: { _id: 'captain-1' },
            createdAt: new Date(now.getTime() - 60_000),
        };

        expect(manualDispatchState(ride, now).canRelaunch).toBe(false);
    });
});
