// SIMULADOR E2E MOVECITY — Cenário 3: corrida agendada.
//
// Mesmo princípio dos Cenários 1/2 — ver o comentário no topo de ride.immediate.test.js
// sobre o jest.mock('../../services/maps.service') precisar estar no topo deste
// arquivo (problema de ordering do mock em setup.js).
//
// Ativação sem esperar relógio real: chama scheduleService.activateDueRides()
// diretamente — a MESMA função que o cron real invoca (schedule.service.js linha
// ~461), não uma reimplementação. `assertValidScheduledAt` exige agendamento entre 15
// minutos e 7 dias à frente; `activateDueRides()` só ativa o que está a ≤10min
// (ACTIVATE_AHEAD_MS) do agora — pra testar sem esperar 15 minutos reais, este
// cenário cria com scheduledAt=+16min (passa a validação real de criação) e então
// adianta esse campo pra +5min via update direto no Mongo, exatamente a mesma técnica
// já usada em tests/unit/schedule.phase1.test.js (backdatar createdAt) pra testar
// lógica de cron sem esperar tempo real — não é escrita de fare/status/distância
// fabricada, só do relógio da própria simulação.
jest.mock('../../services/maps.service');

const mongoose = require('mongoose');
const rideModel = require('../../models/ride.model');
const captainModel = require('../../models/captain.model');
const scheduleService = require('../../services/schedule.service');
const { seedCarCategory } = require('./helpers/seedPricing');
const { createSimUser, createSimCaptain } = require('./helpers/testActors');
const { startSimServer, generateAuthToken } = require('./helpers/simSetup');
const { buildLinearRoute, driveRoute } = require('./helpers/gpsRoute');
const { readWalletSnapshot, readTransactions } = require('./helpers/financialAssertions');
const { printScenarioReport } = require('./helpers/report');

describe('SIMULADOR E2E — Cenário 3: corrida agendada', () => {
    it('agenda, ativa via cron real e percorre o ciclo completo de uma corrida agendada', async () => {
        const steps = [];
        const problems = [];
        const step = (label, ok, detail) => steps.push({ label, ok, detail });

        const sim = await startSimServer();
        try {
            await seedCarCategory();
            step('Seed VehicleCategory real (car, comissão 20%)', true);

            const user = await createSimUser();
            const captain = await createSimCaptain();
            const userToken = generateAuthToken(user, 'user');
            const captainToken = generateAuthToken(captain, 'captain');
            step('Criação de usuário e motorista SIMULATOR reais no DB', true);

            const pickupPoint = { ltd: -23.550520, lng: -46.633308 };
            const endPoint = { ltd: pickupPoint.ltd + 4 / 111.32, lng: pickupPoint.lng };

            const captainSocket = await sim.connectSocket();
            await sim.joinSocket(captainSocket, { userId: captain._id.toString(), userType: 'captain', token: captainToken });
            await driveRoute({ socket: captainSocket, points: [pickupPoint], expectEcho: false });
            step('Motorista conecta, autentica e fixa GPS real', true);

            const toggleRes = await sim.request(sim.app)
                .post('/captains/toggle-online')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ isOnline: true });
            step('POST /captains/toggle-online', toggleRes.statusCode === 200, `status ${toggleRes.statusCode}`);

            const scheduledAt = new Date(Date.now() + 16 * 60 * 1000).toISOString();
            const createRes = await sim.request(sim.app)
                .post('/rides/create')
                .set('Authorization', `Bearer ${userToken}`)
                .set('Idempotency-Key', '30000000-0000-4000-8000-000000000007')
                .send({
                    pickup: 'Avenida Paulista, São Paulo',
                    destination: 'Avenida Brigadeira Faria Lima, São Paulo',
                    vehicleType: 'car',
                    paymentMethod: 'pix',
                    scheduledAt,
                });
            step('POST /rides/create com scheduledAt (+16min, passa validação real de 15min mínimo)', createRes.statusCode === 201, `status ${createRes.statusCode}`);
            if (createRes.statusCode !== 201) {
                problems.push({ severity: '🔴', description: `Falha ao agendar corrida: ${JSON.stringify(createRes.body)}` });
                throw new Error('Não foi possível agendar a corrida — abortando cenário.');
            }
            const rideId = createRes.body._id;
            const estimatedFare = createRes.body.fare;

            const scheduledDoc = await rideModel.findById(rideId).select('status scheduledAt');
            const isScheduled = scheduledDoc.status === 'scheduled';
            step("Corrida fica em status 'scheduled', sem despacho no momento da criação", isScheduled, `status=${scheduledDoc.status}`);

            // Adianta o relógio só deste registro (mesma técnica de schedule.phase1.test.js)
            // pra cair dentro da janela de ativação real (ACTIVATE_AHEAD_MS=10min) sem
            // esperar os 16 minutos reais até o horário agendado.
            await rideModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(rideId) }, { $set: { scheduledAt: new Date(Date.now() + 5 * 60 * 1000) } });
            step('Ajusta scheduledAt pra dentro da janela de ativação (técnica já usada em schedule.phase1.test.js)', true);

            const newRideEvent = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Timeout esperando new-ride via socket')), 5000);
                captainSocket.once('new-ride', (payload) => { clearTimeout(timer); resolve(payload); });
            });

            const activation = await scheduleService.activateDueRides();
            step('scheduleService.activateDueRides() (mesma função do cron real) ativa a corrida', activation.activated === 1, `activated=${activation.activated} dispatch_count=${activation.dispatch_count}`);
            if (activation.activated !== 1) problems.push({ severity: '🔴', description: `activateDueRides não ativou a corrida agendada: ${JSON.stringify(activation)}` });

            const afterActivation = await rideModel.findById(rideId).select('status activatedAt');
            const activatedOk = afterActivation.status === 'requested' && Boolean(afterActivation.activatedAt);
            step("Status transiciona scheduled → 'requested' com activatedAt real", activatedOk, `status=${afterActivation.status} activatedAt=${afterActivation.activatedAt}`);

            const dispatchPayload = await newRideEvent;
            const dispatchedOk = String(dispatchPayload?._id) === String(rideId);
            step("Despacho real via Socket.IO na ativação ('new-ride' chega no motorista)", dispatchedOk, `rideId recebido=${dispatchPayload?._id}`);
            if (!dispatchedOk) problems.push({ severity: '🔴', description: 'Ativação não despachou via socket real para o motorista candidato.' });

            const rideWithOtp = await rideModel.findById(rideId).select('+otp');
            const otp = rideWithOtp.otp;

            const acceptRes = await sim.request(sim.app)
                .post(`/rides/${rideId}/accept`)
                .set('Authorization', `Bearer ${captainToken}`);
            step('POST /rides/:id/accept', acceptRes.statusCode === 200, `status ${acceptRes.statusCode}`);

            for (const status of ['going_to_pickup', 'arrived', 'waiting_passenger']) {
                // eslint-disable-next-line no-await-in-loop
                const res = await sim.request(sim.app)
                    .post('/rides/update-status')
                    .set('Authorization', `Bearer ${captainToken}`)
                    .send({ rideId, status });
                step(`POST /rides/update-status (${status})`, res.statusCode === 200, `status ${res.statusCode}`);
            }

            const startRes = await sim.request(sim.app)
                .get('/rides/start-ride')
                .set('Authorization', `Bearer ${captainToken}`)
                .query({ rideId, otp });
            step('GET /rides/start-ride (OTP real)', startRes.statusCode === 200, `status ${startRes.statusCode}`);

            const route = buildLinearRoute(pickupPoint, endPoint, { stepMeters: 500 });
            await driveRoute({ socket: captainSocket, points: route, delayMs: 15 });
            const rideAfterDrive = await rideModel.findById(rideId).select('actualDistance');
            step('Motorista percorre rota real via GPS (~4km, socket real)', rideAfterDrive.actualDistance > 0, `actualDistance=${rideAfterDrive.actualDistance}m`);

            // Comissão/repasse liquidam na própria finalização desde 2026-08-16 (pra
            // qualquer método de pagamento) — snapshot "before" vem antes do end-ride.
            const walletBefore = await readWalletSnapshot(captain._id);

            const endRes = await sim.request(sim.app)
                .post('/rides/end-ride')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId });
            step('POST /rides/end-ride', endRes.statusCode === 200, `status ${endRes.statusCode}`);
            const finalPrice = endRes.body.finalPrice ?? endRes.body.ride?.finalPrice;
            const recalculated = finalPrice !== estimatedFare;
            step('finalPrice recalculado de verdade também numa corrida agendada', recalculated, `estimativa=${estimatedFare} final=${finalPrice}`);

            const walletAfter = await readWalletSnapshot(captain._id);

            // Liquidação já aconteceu no end-ride acima — este toque manual agora só
            // existe como fallback e é corretamente rejeitado (já confirmado).
            await sim.request(sim.app).post('/rides/pay').set('Authorization', `Bearer ${userToken}`).send({ rideId });
            const confirmRes = await sim.request(sim.app)
                .post('/rides/confirm-payment')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId });
            step('POST /rides/pay + /rides/confirm-payment (agora rejeitado — liquidação já aconteceu no end-ride)', confirmRes.statusCode >= 400, `status ${confirmRes.statusCode}`);
            const finalRide = await rideModel.findById(rideId);
            const captainAfter = await captainModel.findById(captain._id).select('earnings');
            const txs = await readTransactions({ captainId: captain._id, rideId });

            const creditDelta = Number((walletAfter.creditBalance - walletBefore.creditBalance).toFixed(2));
            const commissionOk = Math.abs(creditDelta + finalRide.commissionAmount) < 0.01;
            step('Comissão debitada bate com o finalPrice real (não a estimativa do agendamento)', commissionOk, `delta=${creditDelta} esperado=${-finalRide.commissionAmount}`);

            const earningsOk = captainAfter.earnings === finalPrice;
            step('captain.earnings creditado com o finalPrice real', earningsOk, `earnings=${captainAfter.earnings} finalPrice=${finalPrice}`);

            const txTypesOk = txs.some(t => t.type === 'ride_payment') && txs.some(t => t.type === 'commission');
            step('Transações reais gravadas (ride_payment + commission)', txTypesOk, `tipos=${txs.map(t => t.type).join(',')}`);

            if (!commissionOk) problems.push({ severity: '🔴', description: `Comissão pós-ativação (${creditDelta}) não bate com o esperado (${-finalRide.commissionAmount}).` });
            if (!earningsOk) problems.push({ severity: '🔴', description: `captain.earnings (${captainAfter.earnings}) não bate com finalPrice (${finalPrice}).` });
            if (!txTypesOk) problems.push({ severity: '🔴', description: 'Transações reais de pagamento/comissão não encontradas.' });

            const status = problems.length === 0 ? 'PASS' : 'FAIL';
            printScenarioReport({
                title: 'CENÁRIO 3 — CORRIDA AGENDADA',
                status,
                steps,
                metrics: {
                    rideId,
                    'agendada para (original)': scheduledAt,
                    'estimativa (fare, congelada no booking)': estimatedFare,
                    'valor final cobrado': finalPrice,
                    'comissão (R$)': finalRide.commissionAmount,
                    'carteira do motorista (delta creditBalance)': creditDelta,
                },
                problems,
                notes: [
                    'Ativação via scheduleService.activateDueRides() — a mesma função que o cron de produção chama (schedule.service.js), não uma reimplementação paralela.',
                    'scheduledAt adiantado via update direto no Mongo só pra cair na janela de ativação sem esperar 16 minutos reais — mesma técnica de tests/unit/schedule.phase1.test.js.',
                    'Geocoding de endereço mockado (services/__mocks__/maps.service.js) — estimativa sempre 10km/20min; distância real vem de GPS real via socket.',
                ],
            });

            expect(problems).toEqual([]);
            expect(isScheduled).toBe(true);
            expect(activatedOk).toBe(true);
            expect(dispatchedOk).toBe(true);
            expect(recalculated).toBe(true);
        } finally {
            await sim.stop();
        }
    }, 30000);
});
