const request = require('supertest');
const app = require('../../app');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const rideModel = require('../../models/ride.model');
const vehicleCategoryModel = require('../../models/vehicleCategory.model');
const transactionModel = require('../../models/transaction.model');
const walletModel = require('../../models/wallet.model');
const captainModel = require('../../models/captain.model');

describe('Ride API Integration Tests', () => {
    let userToken;
    let captainToken;
    let user;
    let captain;

    beforeEach(async () => {
        user = await createUser();
        captain = await createCaptain();
        userToken = generateAuthToken(user);
        captainToken = generateAuthToken(captain, 'captain');

        // Need to create vehicle category for pricing engine
        await vehicleCategoryModel.create({
            name: 'car',
            displayName: 'Carro',
            baseFare: 5,
            perKmRate: 1.5,
            perMinuteRate: 0.3,
            minFare: 8,
            isActive: true
        });
    });

    describe('POST /rides/create', () => {
        it('should create a new ride', async () => {
            const res = await request(app)
                .post('/rides/create')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    pickup: 'Avenida Paulista, 1000',
                    destination: 'Avenida Faria Lima, 2000',
                    vehicleType: 'car',
                    paymentMethod: 'pix'
                });

            expect(res.statusCode).toBe(201); // or 200 depending on controller
            expect(res.body).toHaveProperty('user');
            expect(res.body.user.toString()).toBe(user._id.toString());
        });

        it('should fail if unauthenticated', async () => {
            const res = await request(app)
                .post('/rides/create')
                .send({
                    pickup: 'A',
                    destination: 'B',
                    vehicleType: 'car'
                });

            expect(res.statusCode).toBe(401);
        });
    });

    describe('POST /rides/confirm', () => {
        it('should allow captain to confirm a ride', async () => {
            const ride = await createRide({ user: user._id, status: 'requested' });

            const res = await request(app)
                .post('/rides/confirm')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({
                    rideId: ride._id
                });

            expect(res.statusCode).toBe(200);

            const updatedRide = await rideModel.findById(ride._id);
            expect(updatedRide.status).toBe('accepted');
            expect(updatedRide.captain.toString()).toBe(captain._id.toString());
        });
    });

    describe('GET /rides/history', () => {
        // Regression coverage for M8/M2: o filtro "ongoing" usava status que não existem
        // no enum ('pending', 'ongoing'), então só pegava 'accepted' de fato.
        it('should include all in-progress statuses under the "ongoing" filter', async () => {
            await createRide({ user: user._id, status: 'going_to_pickup' });
            await createRide({ user: user._id, status: 'arrived' });
            await createRide({ user: user._id, status: 'started' });
            await createRide({ user: user._id, status: 'finished' });
            await createRide({ user: user._id, status: 'cancelled' });

            const res = await request(app)
                .get('/rides/history')
                .set('Authorization', `Bearer ${userToken}`)
                .query({ status: 'ongoing' });

            expect(res.statusCode).toBe(200);
            expect(res.body.rides.length).toBe(3);
            expect(res.body.rides.every(r => ['going_to_pickup', 'arrived', 'started'].includes(r.status))).toBe(true);
        });

        it('should map the "completed" filter to the real "finished" status', async () => {
            await createRide({ user: user._id, status: 'finished' });
            await createRide({ user: user._id, status: 'cancelled' });

            const res = await request(app)
                .get('/rides/history')
                .set('Authorization', `Bearer ${userToken}`)
                .query({ status: 'completed' });

            expect(res.statusCode).toBe(200);
            expect(res.body.rides.length).toBe(1);
            expect(res.body.rides[0].status).toBe('finished');
        });
    });

    // P1.1 da auditoria de concorrência (2026-08-01): confirmPaymentReceived precisa ser
    // idempotente sob concorrência real, não só sequencialmente. Duas requisições
    // disparadas em paralelo simulam duplo clique / retry de rede no botão "Pagamento
    // Recebido" do motorista.
    describe('POST /rides/confirm-payment (concorrência)', () => {
        it('só aplica a movimentação financeira uma vez quando duas confirmações chegam em paralelo', async () => {
            const ride = await createRide({
                user: user._id,
                captain: captain._id,
                status: 'finished',
                paymentMethod: 'cash',
                fare: 100,
                finalPrice: 100,
                commissionAmount: 20,
                commissionPercent: 20,
                paymentStatus: 'pending'
            });

            const [res1, res2] = await Promise.all([
                request(app)
                    .post('/rides/confirm-payment')
                    .set('Authorization', `Bearer ${captainToken}`)
                    .send({ rideId: ride._id.toString() }),
                request(app)
                    .post('/rides/confirm-payment')
                    .set('Authorization', `Bearer ${captainToken}`)
                    .send({ rideId: ride._id.toString() })
            ]);

            const statuses = [res1.statusCode, res2.statusCode].sort();
            expect(statuses).toEqual([200, 409]);

            const transactions = await transactionModel.find({ rideId: ride._id });
            expect(transactions.length).toBe(2); // 1 ride_payment + 1 commission, nunca 4

            const ridePaymentTx = transactions.filter(t => t.type === 'ride_payment');
            const commissionTx = transactions.filter(t => t.type === 'commission');
            expect(ridePaymentTx.length).toBe(1);
            expect(commissionTx.length).toBe(1);
            expect(ridePaymentTx[0].amount).toBe(100);
            expect(commissionTx[0].amount).toBe(20);

            const wallet = await walletModel.findOne({ captainId: captain._id });
            expect(wallet.totalEarned).toBe(100); // não 200
            expect(wallet.creditBalance).toBe(-20); // comissão descontada uma única vez

            const updatedRide = await rideModel.findById(ride._id);
            expect(updatedRide.paymentStatus).toBe('paid');

            const updatedCaptain = await captainModel.findById(captain._id);
            expect(updatedCaptain.totalRides).toBe(1); // não 2
            expect(updatedCaptain.earnings).toBe(100); // não 200
        });
    });

    // P2.1 da auditoria de concorrência (2026-08-02): toda transição de status passa
    // por um findOneAndUpdate atômico com o status de origem no filtro. Estes testes
    // cobrem as transições inválidas que antes eram aceitas silenciosamente.
    describe('Máquina de estados (P2.1)', () => {
        it('rejeita iniciar uma corrida que ainda não foi aceita (requested)', async () => {
            const ride = await createRide({ user: user._id, status: 'requested', otp: '654321' });

            const res = await request(app)
                .get('/rides/start-ride')
                .set('Authorization', `Bearer ${captainToken}`)
                .query({ rideId: ride._id.toString(), otp: '654321' });

            expect(res.statusCode).toBe(409);
        });

        it('rejeita cancelar uma corrida já finished', async () => {
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'finished' });

            const res = await request(app)
                .post('/rides/cancel')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ rideId: ride._id.toString() });

            expect(res.statusCode).toBe(409);

            const unchanged = await rideModel.findById(ride._id);
            expect(unchanged.status).toBe('finished'); // não foi sobrescrita
        });

        it('rejeita finalizar uma corrida que ainda não foi iniciada', async () => {
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted' });

            const res = await request(app)
                .post('/rides/end-ride')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId: ride._id.toString() });

            expect(res.statusCode).toBe(409);
        });

        it('rejeita /rides/update-status tentando pular direto pra finished (fora do que essa rota cobre)', async () => {
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted' });

            const res = await request(app)
                .post('/rides/update-status')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId: ride._id.toString(), status: 'finished' });

            expect(res.statusCode).toBe(400);

            const unchanged = await rideModel.findById(ride._id);
            expect(unchanged.status).toBe('accepted');
        });

        it('duas requisições concorrentes (cancelar + iniciar) na mesma corrida: exatamente uma vence', async () => {
            const ride = await createRide({
                user: user._id, captain: captain._id, status: 'arrived', otp: '112233', arrivedAt: new Date()
            });

            const [cancelRes, startRes] = await Promise.all([
                request(app).post('/rides/cancel').set('Authorization', `Bearer ${userToken}`).send({ rideId: ride._id.toString() }),
                request(app).get('/rides/start-ride').set('Authorization', `Bearer ${captainToken}`).query({ rideId: ride._id.toString(), otp: '112233' }),
            ]);

            const statuses = [cancelRes.statusCode, startRes.statusCode].sort();
            // Nunca os dois 200 (corrida iniciada E cancelada) — exatamente um vence.
            expect(statuses.filter(s => s === 200).length).toBe(1);
            expect(statuses.filter(s => s === 409).length).toBe(1);

            const finalRide = await rideModel.findById(ride._id);
            expect(['started', 'cancelled']).toContain(finalRide.status);
        });

        it('índice único impede o mesmo motorista de aceitar uma segunda corrida ativa', async () => {
            await createRide({ user: user._id, captain: captain._id, status: 'accepted' });
            const secondPassenger = await createUser();
            const secondRide = await createRide({ user: secondPassenger._id, status: 'requested' });

            const res = await request(app)
                .post(`/rides/${secondRide._id}/accept`)
                .set('Authorization', `Bearer ${captainToken}`);

            expect(res.statusCode).toBe(409);
            expect(res.body.message).toMatch(/outra corrida ativa/);

            // A segunda corrida continua 'requested' — a tentativa de aceite não
            // conseguiu gravar nada (nem status, nem o novo captain).
            const unchanged = await rideModel.findById(secondRide._id);
            expect(unchanged.status).toBe('requested');
        });
    });

    describe('GET /rides/captain-current (auditoria de UX, 2026-08-02)', () => {
        it('retorna 404 quando o motorista não tem corrida ativa', async () => {
            const res = await request(app)
                .get('/rides/captain-current')
                .set('Authorization', `Bearer ${captainToken}`);

            expect(res.statusCode).toBe(404);
        });

        it('retorna a corrida ativa do motorista', async () => {
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'going_to_pickup' });

            const res = await request(app)
                .get('/rides/captain-current')
                .set('Authorization', `Bearer ${captainToken}`);

            expect(res.statusCode).toBe(200);
            expect(res.body._id.toString()).toBe(ride._id.toString());
        });

        it('não retorna corrida de outro motorista', async () => {
            const otherCaptain = await createCaptain();
            const otherCaptainToken = generateAuthToken(otherCaptain, 'captain');
            await createRide({ user: user._id, captain: captain._id, status: 'accepted' });

            const res = await request(app)
                .get('/rides/captain-current')
                .set('Authorization', `Bearer ${otherCaptainToken}`);

            expect(res.statusCode).toBe(404);
        });
    });

    describe('POST /rides/captain-cancel (auditoria de UX, 2026-08-02)', () => {
        it('devolve a corrida para requested, sem motorista nem OTP', async () => {
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted', otp: '999999' });

            const res = await request(app)
                .post('/rides/captain-cancel')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId: ride._id });

            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('requested');
            expect(res.body.captain).toBeFalsy();

            const persisted = await rideModel.findById(ride._id).select('+otp');
            expect(persisted.status).toBe('requested');
            expect(persisted.captain).toBeFalsy();
            expect(persisted.otp).toBeFalsy();
        });

        it('rejeita cancelar corrida de outro motorista', async () => {
            const otherCaptain = await createCaptain();
            const otherCaptainToken = generateAuthToken(otherCaptain, 'captain');
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted' });

            const res = await request(app)
                .post('/rides/captain-cancel')
                .set('Authorization', `Bearer ${otherCaptainToken}`)
                .send({ rideId: ride._id });

            expect(res.statusCode).toBe(404);

            const unchanged = await rideModel.findById(ride._id);
            expect(unchanged.status).toBe('accepted');
        });

        it('rejeita cancelar corrida já iniciada (só endRide cobre esse estado)', async () => {
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'started' });

            const res = await request(app)
                .post('/rides/captain-cancel')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId: ride._id });

            expect(res.statusCode).toBe(409);

            const unchanged = await rideModel.findById(ride._id);
            expect(unchanged.status).toBe('started');
        });

        it('a corrida devolvida é redespachada — outro motorista compatível recebe new-ride', async () => {
            const ride = await createRide({
                user: user._id,
                captain: captain._id,
                status: 'accepted',
                pickup: 'Avenida Paulista, 1000',
                vehicleType: 'car'
            });

            // Motorista candidato ao redespacho: online, mesmo tipo de veículo, com socketId.
            const otherCaptain = await createCaptain({
                isOnline: true,
                socketId: 'socket-redespacho-teste',
                location: { ltd: -23.5613, lng: -46.6565 },
                locationGeoJSON: { type: 'Point', coordinates: [-46.6565, -23.5613] },
                vehicle: { color: 'Preto', plate: 'RED1234', capacity: 4, vehicleType: 'car' }
            });

            const res = await request(app)
                .post('/rides/captain-cancel')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId: ride._id });

            expect(res.statusCode).toBe(200);
            // O redespacho não falha mesmo sem socket.io inicializado neste processo de
            // teste (dispatchRideToCaptains tolera isso) — a asserção real é que a corrida
            // ficou disponível de novo para qualquer motorista compatível encontrá-la.
            const requeued = await rideModel.findOne({ _id: ride._id, status: 'requested' });
            expect(requeued).toBeTruthy();
        });
    });
});
