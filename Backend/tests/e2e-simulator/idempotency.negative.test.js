// SIMULADOR E2E MOVECITY — Idempotência e casos negativos.
//
// Ver o comentário no topo de ride.immediate.test.js sobre o jest.mock precisar estar
// no topo deste arquivo (problema de ordering do mock de geocoding em setup.js).
jest.mock('../../services/maps.service');

const rideModel = require('../../models/ride.model');
const parcelModel = require('../../models/parcel.model');
const { seedCarCategory } = require('./helpers/seedPricing');
const { createSimUser, createSimCaptain } = require('./helpers/testActors');
const { startSimServer, generateAuthToken } = require('./helpers/simSetup');
const { driveRoute } = require('./helpers/gpsRoute');
const { printScenarioReport } = require('./helpers/report');

const pickupPoint = { ltd: -23.550520, lng: -46.633308 };

async function onlineCaptain(sim, overrides = {}) {
    const captain = await createSimCaptain(overrides);
    const token = generateAuthToken(captain, 'captain');
    const socket = await sim.connectSocket();
    await sim.joinSocket(socket, { userId: captain._id.toString(), userType: 'captain', token });
    await driveRoute({ socket, points: [pickupPoint], expectEcho: false });
    await sim.request(sim.app).post('/captains/toggle-online').set('Authorization', `Bearer ${token}`).send({ isOnline: true });
    return { captain, token, socket };
}

describe('SIMULADOR E2E — Idempotência e casos negativos', () => {
    const results = [];

    afterAll(() => {
        printScenarioReport({
            title: 'IDEMPOTÊNCIA E CASOS NEGATIVOS',
            status: results.every(r => r.ok) ? 'PASS' : 'FAIL',
            steps: results.map(r => ({ label: r.label, ok: r.ok, detail: r.detail })),
            metrics: {},
            problems: results.filter(r => !r.ok).map(r => ({ severity: '🔴', description: r.label })),
            notes: [
                'Cada teste roda com seu próprio servidor HTTP+Socket.IO real e atores SIMULATOR próprios.',
            ],
        });
    });

    it('duas requisições concorrentes de accept na mesma corrida: exatamente um motorista vence', async () => {
        const sim = await startSimServer();
        try {
            await seedCarCategory();
            const user = await createSimUser();
            const userToken = generateAuthToken(user, 'user');
            const winnerRig = await onlineCaptain(sim);
            const loserRig = await onlineCaptain(sim, { vehicle: { color: 'white', plate: 'SIM0001', capacity: 4, vehicleType: 'car' } });

            const createRes = await sim.request(sim.app)
                .post('/rides/create')
                .set('Authorization', `Bearer ${userToken}`)
                .set('Idempotency-Key', '30000000-0000-4000-8000-000000000008')
                .send({ pickup: 'Avenida Paulista, São Paulo', destination: 'Avenida Faria Lima, São Paulo', vehicleType: 'car', paymentMethod: 'pix' });
            const rideId = createRes.body._id;

            const [res1, res2] = await Promise.all([
                sim.request(sim.app).post(`/rides/${rideId}/accept`).set('Authorization', `Bearer ${winnerRig.token}`),
                sim.request(sim.app).post(`/rides/${rideId}/accept`).set('Authorization', `Bearer ${loserRig.token}`),
            ]);

            const statuses = [res1.statusCode, res2.statusCode].sort();
            const exactlyOneWinner = statuses[0] === 200 && statuses[1] !== 200;
            results.push({ label: 'Accept concorrente de corrida: exatamente 1 de 2 vence', ok: exactlyOneWinner, detail: `status1=${res1.statusCode} status2=${res2.statusCode}` });
            expect(exactlyOneWinner).toBe(true);

            const finalRide = await rideModel.findById(rideId).select('captain status');
            const captainAssignedIsWinner = res1.statusCode === 200
                ? String(finalRide.captain) === String(winnerRig.captain._id)
                : String(finalRide.captain) === String(loserRig.captain._id);
            results.push({ label: 'DB reflete exatamente o motorista que recebeu 200', ok: captainAssignedIsWinner });
            expect(captainAssignedIsWinner).toBe(true);
        } finally {
            await sim.stop();
        }
    }, 30000);

    it('duas requisições concorrentes de accept na mesma encomenda: exatamente um motorista vence', async () => {
        const sim = await startSimServer();
        try {
            await seedCarCategory();
            const user = await createSimUser();
            const userToken = generateAuthToken(user, 'user');
            const rigA = await onlineCaptain(sim);
            const rigB = await onlineCaptain(sim, { vehicle: { color: 'white', plate: 'SIM0002', capacity: 4, vehicleType: 'car' } });

            const createRes = await sim.request(sim.app)
                .post('/parcels/create')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    pickup: 'Avenida Paulista, São Paulo',
                    destination: 'Avenida Faria Lima, São Paulo',
                    vehicleType: 'car',
                    sender: { name: 'Remetente', phone: '+5511900000001' },
                    recipient: { name: 'Destinatário', phone: '+5511900000002' },
                    itemName: 'Pacote concorrência',
                    category: 'outros',
                    weightKg: 1,
                    size: 'small',
                    paymentMethod: 'pix',
                });
            const parcelId = createRes.body._id;

            const [res1, res2] = await Promise.all([
                sim.request(sim.app).post(`/parcels/${parcelId}/accept`).set('Authorization', `Bearer ${rigA.token}`),
                sim.request(sim.app).post(`/parcels/${parcelId}/accept`).set('Authorization', `Bearer ${rigB.token}`),
            ]);

            const statuses = [res1.statusCode, res2.statusCode].sort();
            const exactlyOneWinner = statuses[0] === 200 && statuses[1] !== 200;
            results.push({ label: 'Accept concorrente de encomenda: exatamente 1 de 2 vence', ok: exactlyOneWinner, detail: `status1=${res1.statusCode} status2=${res2.statusCode}` });
            expect(exactlyOneWinner).toBe(true);
        } finally {
            await sim.stop();
        }
    }, 30000);

    it('confirmar pagamento de corrida duas vezes não duplica transação nem credita carteira 2x', async () => {
        const sim = await startSimServer();
        try {
            await seedCarCategory();
            const user = await createSimUser();
            const userToken = generateAuthToken(user, 'user');
            const rig = await onlineCaptain(sim);

            const createRes = await sim.request(sim.app)
                .post('/rides/create')
                .set('Authorization', `Bearer ${userToken}`)
                .set('Idempotency-Key', '30000000-0000-4000-8000-000000000009')
                .send({ pickup: 'Avenida Paulista, São Paulo', destination: 'Avenida Faria Lima, São Paulo', vehicleType: 'car', paymentMethod: 'pix' });
            const rideId = createRes.body._id;

            await sim.request(sim.app).post(`/rides/${rideId}/accept`).set('Authorization', `Bearer ${rig.token}`);
            for (const status of ['going_to_pickup', 'arrived', 'waiting_passenger']) {
                // eslint-disable-next-line no-await-in-loop
                await sim.request(sim.app).post('/rides/update-status').set('Authorization', `Bearer ${rig.token}`).send({ rideId, status });
            }
            const rideWithOtp = await rideModel.findById(rideId).select('+otp');
            await sim.request(sim.app).get('/rides/start-ride').set('Authorization', `Bearer ${rig.token}`).query({ rideId, otp: rideWithOtp.otp });
            await driveRoute({ socket: rig.socket, points: [{ ltd: pickupPoint.ltd + 0.01, lng: pickupPoint.lng }], delayMs: 0 });
            // Desde 2026-08-16, comissão/repasse liquidam na própria finalização
            // (end-ride) pra qualquer método de pagamento — não mais num toque
            // separado de "pagamento recebido". Por isso as duas chamadas de
            // confirm-payment abaixo são rejeitadas: a liquidação real já aconteceu
            // no end-ride logo acima. O teste continua provando a mesma coisa
            // (nenhuma duplicação de transação), só que pela via de idempotência do
            // end-ride em vez da de confirm-payment.
            await sim.request(sim.app).post('/rides/end-ride').set('Authorization', `Bearer ${rig.token}`).send({ rideId });
            await sim.request(sim.app).post('/rides/pay').set('Authorization', `Bearer ${userToken}`).send({ rideId });

            const first = await sim.request(sim.app).post('/rides/confirm-payment').set('Authorization', `Bearer ${rig.token}`).send({ rideId });
            const second = await sim.request(sim.app).post('/rides/confirm-payment').set('Authorization', `Bearer ${rig.token}`).send({ rideId });

            const bothRejected = first.statusCode >= 400 && second.statusCode >= 400;
            results.push({ label: 'confirm-payment de corrida 2x após liquidação automática: ambas rejeitadas', ok: bothRejected, detail: `1ª=${first.statusCode} 2ª=${second.statusCode}` });
            expect(bothRejected).toBe(true);

            const transactionModel = require('../../models/transaction.model');
            const commissionTxs = await transactionModel.find({ rideId, type: 'commission' });
            const noDuplicateTx = commissionTxs.length === 1;
            results.push({ label: 'Apenas 1 transação de comissão gravada (sem duplicação)', ok: noDuplicateTx, detail: `count=${commissionTxs.length}` });
            expect(noDuplicateTx).toBe(true);
        } finally {
            await sim.stop();
        }
    }, 30000);

    it('paymentMethod=card é rejeitado por /rides/create (não existe gateway real por trás)', async () => {
        const sim = await startSimServer();
        try {
            await seedCarCategory();
            const user = await createSimUser();
            const userToken = generateAuthToken(user, 'user');

            const res = await sim.request(sim.app)
                .post('/rides/create')
                .set('Authorization', `Bearer ${userToken}`)
                .set('Idempotency-Key', '30000000-0000-4000-8000-000000000010')
                .send({ pickup: 'Avenida Paulista, São Paulo', destination: 'Avenida Faria Lima, São Paulo', vehicleType: 'car', paymentMethod: 'card' });

            const rejected = res.statusCode === 400;
            results.push({ label: 'paymentMethod=card rejeitado em /rides/create', ok: rejected, detail: `status=${res.statusCode}` });
            expect(rejected).toBe(true);
        } finally {
            await sim.stop();
        }
    }, 30000);

    it('OTP errado em /rides/start-ride é rejeitado e não transiciona o status', async () => {
        const sim = await startSimServer();
        try {
            await seedCarCategory();
            const user = await createSimUser();
            const userToken = generateAuthToken(user, 'user');
            const rig = await onlineCaptain(sim);

            const createRes = await sim.request(sim.app)
                .post('/rides/create')
                .set('Authorization', `Bearer ${userToken}`)
                .set('Idempotency-Key', '30000000-0000-4000-8000-000000000011')
                .send({ pickup: 'Avenida Paulista, São Paulo', destination: 'Avenida Faria Lima, São Paulo', vehicleType: 'car', paymentMethod: 'pix' });
            const rideId = createRes.body._id;

            await sim.request(sim.app).post(`/rides/${rideId}/accept`).set('Authorization', `Bearer ${rig.token}`);
            for (const status of ['going_to_pickup', 'arrived', 'waiting_passenger']) {
                // eslint-disable-next-line no-await-in-loop
                await sim.request(sim.app).post('/rides/update-status').set('Authorization', `Bearer ${rig.token}`).send({ rideId, status });
            }

            const wrongRes = await sim.request(sim.app)
                .get('/rides/start-ride')
                .set('Authorization', `Bearer ${rig.token}`)
                .query({ rideId, otp: '000000' });
            const rejected = wrongRes.statusCode >= 400;
            results.push({ label: 'OTP errado rejeitado em /rides/start-ride', ok: rejected, detail: `status=${wrongRes.statusCode}` });
            expect(rejected).toBe(true);

            const stillWaiting = await rideModel.findById(rideId).select('status');
            const noTransition = stillWaiting.status === 'waiting_passenger';
            results.push({ label: 'Status não transiciona para started com OTP errado', ok: noTransition, detail: `status=${stillWaiting.status}` });
            expect(noTransition).toBe(true);
        } finally {
            await sim.stop();
        }
    }, 30000);

    it('PIN errado em /parcels/:id/confirm-delivery é rejeitado e não finaliza a encomenda', async () => {
        const sim = await startSimServer();
        try {
            await seedCarCategory();
            const user = await createSimUser();
            const userToken = generateAuthToken(user, 'user');
            const rig = await onlineCaptain(sim);

            const createRes = await sim.request(sim.app)
                .post('/parcels/create')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    pickup: 'Avenida Paulista, São Paulo',
                    destination: 'Avenida Faria Lima, São Paulo',
                    vehicleType: 'car',
                    sender: { name: 'Remetente', phone: '+5511900000001' },
                    recipient: { name: 'Destinatário', phone: '+5511900000002' },
                    itemName: 'Pacote PIN errado',
                    category: 'outros',
                    weightKg: 1,
                    size: 'small',
                    paymentMethod: 'pix',
                });
            const parcelId = createRes.body._id;
            await sim.request(sim.app).post(`/parcels/${parcelId}/accept`).set('Authorization', `Bearer ${rig.token}`);
            for (const status of ['going_to_pickup', 'arrived_pickup', 'collected', 'in_transit', 'arrived_destination']) {
                // eslint-disable-next-line no-await-in-loop
                await sim.request(sim.app).patch(`/parcels/${parcelId}/status`).set('Authorization', `Bearer ${rig.token}`).send({ status });
            }

            const wrongPinRes = await sim.request(sim.app)
                .post(`/parcels/${parcelId}/confirm-delivery`)
                .set('Authorization', `Bearer ${rig.token}`)
                .send({ pin: '9999' });
            const rejected = wrongPinRes.statusCode === 400;
            results.push({ label: 'PIN errado rejeitado em /parcels/:id/confirm-delivery', ok: rejected, detail: `status=${wrongPinRes.statusCode}` });
            expect(rejected).toBe(true);

            const stillActive = await parcelModel.findById(parcelId).select('status');
            const notFinished = stillActive.status === 'arrived_destination';
            results.push({ label: 'Status não transiciona para finished com PIN errado', ok: notFinished, detail: `status=${stillActive.status}` });
            expect(notFinished).toBe(true);
        } finally {
            await sim.stop();
        }
    }, 30000);
});
