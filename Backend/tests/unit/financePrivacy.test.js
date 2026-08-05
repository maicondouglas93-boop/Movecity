const {
    computeDriverAmount,
    sanitizeCaptainFinance,
    sanitizeEarningsBreakdown,
    sanitizeCaptainWallet,
    sanitizeCaptainTransactions,
} = require('../../utils/financePrivacy');

describe('financePrivacy', () => {
    describe('computeDriverAmount', () => {
        it('subtrai comissão do bruto', () => {
            expect(computeDriverAmount({ fare: 20, commissionAmount: 4 })).toBe(16);
            expect(computeDriverAmount({ finalPrice: 25, commissionAmount: 5 })).toBe(20);
        });

        it('trata valores inválidos como zero', () => {
            expect(computeDriverAmount({})).toBe(0);
            expect(computeDriverAmount({ fare: 'x', commissionAmount: 2 })).toBe(0);
        });
    });

    describe('sanitizeCaptainFinance', () => {
        it('remove comissão/bruto e expõe só líquido', () => {
            const out = sanitizeCaptainFinance({
                _id: 'r1',
                fare: 20,
                finalPrice: 20,
                commissionAmount: 4,
                commissionPercent: 20,
                fareBreakdown: { platformCommission: 4, baseFare: 5 },
                pricingSnapshot: { commissionPercent: 20 },
                status: 'finished',
            });

            expect(out.driverAmount).toBe(16);
            expect(out.fare).toBe(16);
            expect(out.finalPrice).toBe(16);
            expect(out.commissionAmount).toBeUndefined();
            expect(out.commissionPercent).toBeUndefined();
            expect(out.fareBreakdown).toBeUndefined();
            expect(out.pricingSnapshot).toBeUndefined();
            expect(out.status).toBe('finished');
        });
    });

    describe('sanitizeEarningsBreakdown', () => {
        it('não expõe bruto nem comissão por corrida', () => {
            const out = sanitizeEarningsBreakdown({
                range: 'day',
                totalEarnings: 16,
                totalCommission: 4,
                totalRides: 1,
                rides: [{
                    rideId: 'r1',
                    date: '2026-01-01',
                    pickup: 'A',
                    destination: 'B',
                    grossFare: 20,
                    commission: 4,
                    netEarnings: 16,
                }],
            });

            expect(out.totalCommission).toBeUndefined();
            expect(out.rides[0].driverAmount).toBe(16);
            expect(out.rides[0].grossFare).toBeUndefined();
            expect(out.rides[0].commission).toBeUndefined();
        });
    });

    describe('sanitizeCaptainWallet', () => {
        it('remove totalCommissionPaid', () => {
            const out = sanitizeCaptainWallet({
                creditBalance: 100,
                totalCommissionPaid: 40,
                totalEarned: 200,
            });
            expect(out.creditBalance).toBe(100);
            expect(out.totalCommissionPaid).toBeUndefined();
            expect(out.totalEarned).toBe(200);
        });
    });

    describe('sanitizeCaptainTransactions', () => {
        it('filtra comissão e normaliza cash para líquido', () => {
            const out = sanitizeCaptainTransactions([
                {
                    type: 'ride_payment',
                    paymentMethod: 'cash',
                    amount: 20,
                    rideId: 'r1',
                    description: 'Corrida #abc (cash)',
                },
                {
                    type: 'commission',
                    paymentMethod: 'wallet',
                    amount: 4,
                    rideId: 'r1',
                    description: 'Comissão corrida #abc (20%)',
                },
            ]);

            expect(out).toHaveLength(1);
            expect(out[0].type).toBe('ride_payment');
            expect(out[0].amount).toBe(16);
            expect(out[0].description).not.toMatch(/%/);
        });

        it('mantém ride_payment de cartão (já líquido)', () => {
            const out = sanitizeCaptainTransactions([
                {
                    type: 'ride_payment',
                    paymentMethod: 'card',
                    amount: 16,
                    rideId: 'r2',
                    description: 'Repasse cartão',
                },
            ]);
            expect(out[0].amount).toBe(16);
        });

        it('usa hints quando a comissão não está no lote', () => {
            const out = sanitizeCaptainTransactions(
                [{
                    type: 'parcel_payment',
                    paymentMethod: 'pix',
                    amount: 50,
                    parcelId: 'p1',
                    description: 'Encomenda',
                }],
                { commissionByParcel: { p1: 10 } }
            );
            expect(out[0].amount).toBe(40);
        });
    });
});
