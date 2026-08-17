const rideService = require('../../services/ride.service');
const rideModel = require('../../models/ride.model');
const tariffSettingModel = require('../../models/tariffSetting.model');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');

// Regression coverage for A9: cancellationFee e perMinuteWaitFee/maxFreeWaitTime eram
// campos editáveis no painel que nenhum código lia — o admin salvava "com sucesso" e
// nada acontecia.
describe('Ride Service — cancellation & wait-time fees', () => {
    beforeEach(async () => {
        await tariffSettingModel.create({
            maxFreeWaitTime: 300, // 5 min grátis
            perMinuteWaitFee: 1.0,
            cancellationFee: 7.5
        });
    });

    describe('cancelRide', () => {
        it('should charge the cancellation fee when a captain is already assigned', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted' });

            const result = await rideService.cancelRide({ rideId: ride._id, user: user._id });

            expect(result.cancellationFeeCharged).toBe(7.5);
        });

        it('should NOT charge a cancellation fee when no captain has accepted yet', async () => {
            const user = await createUser();
            const ride = await createRide({ user: user._id, captain: null, status: 'requested' });

            const result = await rideService.cancelRide({ rideId: ride._id, user: user._id });

            expect(result.cancellationFeeCharged).toBe(0);
        });
    });

    describe('startRide', () => {
        it('should charge a wait-time fee when the driver waited past the free window', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'arrived', arrivedAt: tenMinutesAgo, otp: '1234'
            });

            const result = await rideService.startRide({ rideId: ride._id, otp: '1234', captain });

            // 10 min de espera - 5 min grátis = 5 min excedentes * R$1,00/min = R$5,00
            expect(result.waitTimeFeeCharged).toBeCloseTo(5.0, 1);
        });

        // Regressão do achado 02 da auditoria de corrida ativa (2026-08-16): o motorista
        // marca "cheguei" com sinal, embarca o passageiro logo depois mas já sem sinal, e
        // a fila offline só sincroniza uma hora adiante. Sem o instante real do embarque,
        // waitTimeSeconds virava (sincronização − chegada) e cobrava do passageiro uma
        // hora de espera parada no ponto que nunca existiu.
        it('cobra só a espera real quando o embarque foi offline e sincronizou muito depois', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const arrivedAt = new Date(Date.now() - 65 * 60 * 1000);
            const boardedAt = arrivedAt.getTime() + 8 * 60 * 1000; // embarcou 8 min depois
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'arrived', arrivedAt, otp: '1234'
            });

            const result = await rideService.startRide({
                rideId: ride._id, otp: '1234', captain, occurredAt: boardedAt,
            });

            // 8 min de espera − 5 grátis = 3 min × R$1,00 = R$3,00 (e não os ~60 min
            // que sairiam do relógio do servidor no momento da sincronização).
            expect(result.waitTimeFeeCharged).toBeCloseTo(3.0, 1);
            expect(result.waitTimeSeconds).toBeCloseTo(480, 0);
            expect(new Date(result.startedAt).getTime()).toBe(boardedAt);
        });

        it('descarta instante de embarque no futuro e usa o relógio do servidor', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const arrivedAt = new Date(Date.now() - 10 * 60 * 1000);
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'arrived', arrivedAt, otp: '1234'
            });

            const result = await rideService.startRide({
                rideId: ride._id, otp: '1234', captain, occurredAt: Date.now() + 60 * 60 * 1000,
            });

            // Relógio adulterado no aparelho não encurta a espera devida.
            expect(result.waitTimeFeeCharged).toBeCloseTo(5.0, 1);
        });

        it('should NOT charge a wait-time fee within the free window', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'arrived', arrivedAt: oneMinuteAgo, otp: '1234'
            });

            const result = await rideService.startRide({ rideId: ride._id, otp: '1234', captain });

            expect(result.waitTimeFeeCharged).toBe(0);
        });

        it('should NOT charge a wait-time fee when the driver never marked arrived', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'accepted', otp: '1234'
            });

            const result = await rideService.startRide({ rideId: ride._id, otp: '1234', captain });

            expect(result.waitTimeFeeCharged).toBe(0);
        });
    });

    describe('endRide', () => {
        it('should add the wait-time fee charged at startRide to the final price', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'started',
                fare: 20, waitTimeFeeCharged: 5, actualDistance: 0,
                // Comissão/repasse liquidam dentro do próprio endRide desde 2026-08-16 —
                // uma corrida real sempre chega aqui com isso congelado no booking
                // (calculateRideFare), então a fixture reflete o mesmo.
                commissionAmount: 5, commissionPercent: 20,
            });

            const result = await rideService.endRide({ rideId: ride._id, captain });

            expect(result.finalPrice).toBe(25); // 20 (fare, sem recálculo por distância) + 5 de espera
        });

        it('should keep frozen optionals in the final price after endRide', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'started',
                fare: 20, waitTimeFeeCharged: 0, actualDistance: 0,
                commissionAmount: 5, commissionPercent: 20,
                optionals: [
                    { type: 'aceita_animais', price: 3 },
                    { type: 'disposicao_passageiro', price: 15 },
                ],
            });

            const result = await rideService.endRide({ rideId: ride._id, captain });

            expect(result.finalPrice).toBe(38); // 20 + 3 + 15
        });
    });

    describe('pricingSnapshot preference', () => {
        it('should charge cancellation fee from the ride snapshot, not live tariff', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            const ride = await createRide({
                user: user._id,
                captain: captain._id,
                status: 'accepted',
                pricingSnapshot: {
                    tariffSetting: { cancellationFee: 12.5, maxFreeWaitTime: 300, perMinuteWaitFee: 1 },
                },
            });

            // Live tariff (beforeEach) tem cancellationFee 7.5 — snapshot manda.
            const result = await rideService.cancelRide({ rideId: ride._id, user: user._id });
            expect(result.cancellationFeeCharged).toBe(12.5);
        });

        it('should charge wait fee from the ride snapshot, not live tariff', async () => {
            const user = await createUser();
            const captain = await createCaptain();
            // 9 min: acima da janela grátis do live (5 min) mas dentro da do snapshot
            // (10 min) — distingue as duas fontes sem cravar o teste exatamente na
            // borda dos 10 min (flaky: o tempo de execução real entre criar a fixture
            // e o Date.now() lido dentro de startRide já basta pra estourar por alguns ms).
            const nineMinutesAgo = new Date(Date.now() - 9 * 60 * 1000);
            const ride = await createRide({
                user: user._id,
                captain: captain._id,
                status: 'arrived',
                arrivedAt: nineMinutesAgo,
                otp: '1234',
                pricingSnapshot: {
                    // 10 min grátis → 0 de taxa apesar do live (5 min / R$1)
                    tariffSetting: { maxFreeWaitTime: 600, perMinuteWaitFee: 9, cancellationFee: 0 },
                },
            });

            const result = await rideService.startRide({ rideId: ride._id, otp: '1234', captain });
            expect(result.waitTimeFeeCharged).toBe(0);
        });
    });
});
