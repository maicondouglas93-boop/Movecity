// SIMULADOR E2E MOVECITY — Cenário 1: corrida imediata.
//
// Fluxo 100% real (nenhuma lógica paralela): HTTP real (supertest → app real),
// Socket.IO real (server real + socket.io-client real), PricingEngine real,
// wallet.service real, schedule.service não entra aqui (fluxo imediato).
//
// Única camada mockada: geocoding de endereço → coordenada
// (services/__mocks__/maps.service.js — getAddressCoordinate/getDistanceTime
// retornam valores fixos; haversineKm e getCaptainsInTheRadius continuam sendo a
// implementação real via jest.requireActual dentro do próprio mock).
//
// `jest.mock` abaixo é chamado no TOPO deste arquivo (hoisted pelo babel-plugin-
// jest-hoist pra antes de todo require) de propósito: tests/setup/setup.js chama
// `jest.mock('../../services/maps.service')` dentro de um `beforeAll`, que só roda
// DEPOIS que este arquivo já terminou de fazer todos os seus requires no topo —
// incluindo app.js → ride.controller → ride.service → maps.service. Nessa ordem, o
// mock de setup.js nunca chega a valer para quem já capturou a referência real do
// módulo. Sem este jest.mock aqui, o simulador acaba chamando o provider de mapas
// real (services/maps/index.js) de verdade — foi assim que a estimativa saiu como
// a distância real entre os dois endereços de São Paulo, não o valor fixo do mock.
jest.mock('../../services/maps.service');

const rideModel = require('../../models/ride.model');
const captainModel = require('../../models/captain.model');
const { seedCarCategory } = require('./helpers/seedPricing');
const { createSimUser, createSimCaptain } = require('./helpers/testActors');
const { startSimServer, generateAuthToken } = require('./helpers/simSetup');
const { buildLinearRoute, driveRoute } = require('./helpers/gpsRoute');
const { readWalletSnapshot, readTransactions } = require('./helpers/financialAssertions');
const { printScenarioReport } = require('./helpers/report');

describe('SIMULADOR E2E — Cenário 1: corrida imediata', () => {
    it('percorre todo o ciclo real de uma corrida imediata e fecha as contas', async () => {
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

            // Ponto fixo pro qual TODO endereço resolve neste ambiente de teste
            // (mock de geocoding) — usado como origem real da rota de GPS.
            const pickupPoint = { ltd: -23.550520, lng: -46.633308 };
            // ~6km ao norte — deliberadamente diferente dos 10km da estimativa
            // (getDistanceTime mockado), pra provar recálculo real em endRide.
            const endPoint = { ltd: pickupPoint.ltd + 6 / 111.32, lng: pickupPoint.lng };

            const captainSocket = await sim.connectSocket();
            await sim.joinSocket(captainSocket, { userId: captain._id.toString(), userType: 'captain', token: captainToken });
            step('Motorista conecta e autentica via socket real (join)', true);

            // Fixa a posição real do motorista via evento real 'update-location-captain'
            // (não escrita direta no banco) — necessário pro despacho por raio encontrá-lo.
            await driveRoute({ socket: captainSocket, points: [pickupPoint], expectEcho: false });
            step('Motorista emite fix de GPS real (fixa location/locationGeoJSON)', true);

            const toggleRes = await sim.request(sim.app)
                .post('/captains/toggle-online')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ isOnline: true });
            step('POST /captains/toggle-online', toggleRes.statusCode === 200, `status ${toggleRes.statusCode}`);
            if (toggleRes.statusCode !== 200) problems.push({ severity: '🔴', description: `toggle-online falhou: ${JSON.stringify(toggleRes.body)}` });

            const newRideEvent = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Timeout esperando new-ride via socket')), 5000);
                captainSocket.once('new-ride', (payload) => { clearTimeout(timer); resolve(payload); });
            });

            const createRes = await sim.request(sim.app)
                .post('/rides/create')
                .set('Authorization', `Bearer ${userToken}`)
                .set('Idempotency-Key', '30000000-0000-4000-8000-000000000006')
                .send({
                    pickup: 'Avenida Paulista, São Paulo',
                    destination: 'Avenida Brigadeira Faria Lima, São Paulo',
                    vehicleType: 'car',
                    paymentMethod: 'pix',
                });
            step('POST /rides/create (passageiro)', createRes.statusCode === 201, `status ${createRes.statusCode}`);
            if (createRes.statusCode !== 201) {
                problems.push({ severity: '🔴', description: `Falha ao criar corrida: ${JSON.stringify(createRes.body)}` });
                throw new Error('Não foi possível criar a corrida — abortando cenário.');
            }
            const rideId = createRes.body._id;
            const estimatedFare = createRes.body.fare;
            const estimatedDistance = createRes.body.estimatedDistance;
            const commissionPercent = createRes.body.commissionPercent;
            const commissionAmount = createRes.body.commissionAmount;

            // sendMessageToSocketId (socket.js) emite io.to(socketId).emit(event, data) —
            // o payload do evento é o objeto da corrida direto, não {data: ride}.
            const dispatchPayload = await newRideEvent;
            const dispatchedOk = String(dispatchPayload?._id) === String(rideId);
            step("Despacho real via Socket.IO ('new-ride' chega no motorista candidato)", dispatchedOk, `rideId recebido=${dispatchPayload?._id}`);
            if (!dispatchedOk) problems.push({ severity: '🔴', description: 'Motorista online no raio não recebeu o evento new-ride real.' });

            const rideWithOtp = await rideModel.findById(rideId).select('+otp');
            const otp = rideWithOtp.otp;
            step('Leitura do OTP real gerado na criação (select +otp)', Boolean(otp && otp.length === 6));

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
                if (res.statusCode !== 200) problems.push({ severity: '🔴', description: `Transição para ${status} falhou: ${JSON.stringify(res.body)}` });
            }

            const startRes = await sim.request(sim.app)
                .get('/rides/start-ride')
                .set('Authorization', `Bearer ${captainToken}`)
                .query({ rideId, otp });
            step('GET /rides/start-ride (OTP real)', startRes.statusCode === 200, `status ${startRes.statusCode}`);

            const route = buildLinearRoute(pickupPoint, endPoint, { stepMeters: 500 });
            await driveRoute({ socket: captainSocket, points: route, delayMs: 15 });
            const rideAfterDrive = await rideModel.findById(rideId).select('actualDistance');
            const actualDistance = rideAfterDrive.actualDistance;
            step('Motorista percorre rota real via GPS (~6km, socket real)', actualDistance > 0, `actualDistance=${actualDistance}m`);

            const endRes = await sim.request(sim.app)
                .post('/rides/end-ride')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId });
            step('POST /rides/end-ride', endRes.statusCode === 200, `status ${endRes.statusCode}`);
            const finalPrice = endRes.body.finalPrice ?? endRes.body.ride?.finalPrice;

            const recalculated = finalPrice !== estimatedFare;
            step('finalPrice recalculado de verdade (≠ estimativa)', recalculated, `estimativa=${estimatedFare} final=${finalPrice}`);
            if (!recalculated) problems.push({ severity: '🔴', description: 'endRide devolveu finalPrice igual à estimativa mesmo com distância real diferente.' });

            const cheaperAsExpected = finalPrice < estimatedFare;
            step('Corrida mais curta que a estimativa cobra menos', cheaperAsExpected, `estimativa=${estimatedFare} final=${finalPrice}`);

            const walletBefore = await readWalletSnapshot(captain._id);

            const payRes = await sim.request(sim.app)
                .post('/rides/pay')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ rideId });
            step('POST /rides/pay (passageiro confirma pagamento)', payRes.statusCode === 200, `status ${payRes.statusCode}`);

            const confirmRes = await sim.request(sim.app)
                .post('/rides/confirm-payment')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId });
            step('POST /rides/confirm-payment (motorista confirma recebimento)', confirmRes.statusCode === 200, `status ${confirmRes.statusCode}`);

            const walletAfter = await readWalletSnapshot(captain._id);
            const finalRide = await rideModel.findById(rideId);
            const captainAfter = await captainModel.findById(captain._id).select('earnings totalRides');
            const txs = await readTransactions({ captainId: captain._id, rideId });

            const expectedCommission = finalRide.commissionAmount;
            const creditDelta = Number((walletAfter.creditBalance - walletBefore.creditBalance).toFixed(2));
            const commissionOk = Math.abs(creditDelta + expectedCommission) < 0.01;
            step('Comissão debitada da carteira bate com finalPrice (não a estimativa)', commissionOk, `delta=${creditDelta} esperado=${-expectedCommission}`);
            if (!commissionOk) problems.push({ severity: '🔴', description: `Comissão debitada (${creditDelta}) não bate com commissionAmount do finalPrice (${expectedCommission}).` });

            const earningsOk = captainAfter.earnings === finalPrice;
            step('captain.earnings creditado com o finalPrice real', earningsOk, `earnings=${captainAfter.earnings} finalPrice=${finalPrice}`);

            const txTypesOk = txs.some(t => t.type === 'ride_payment') && txs.some(t => t.type === 'commission');
            step('Transações reais gravadas (ride_payment + commission)', txTypesOk, `tipos=${txs.map(t => t.type).join(',')}`);

            const status = problems.length === 0 ? 'PASS' : 'FAIL';
            printScenarioReport({
                title: 'CENÁRIO 1 — CORRIDA IMEDIATA',
                status,
                steps,
                metrics: {
                    rideId,
                    'estimativa (fare)': estimatedFare,
                    'estimativa (distância)': `${estimatedDistance}m`,
                    'distância real percorrida': `${actualDistance}m`,
                    'valor final cobrado': finalPrice,
                    'comissão (%)': commissionPercent,
                    'comissão (R$)': expectedCommission,
                    'carteira do motorista (delta creditBalance)': creditDelta,
                },
                problems,
                notes: [
                    'Geocoding de endereço mockado (services/__mocks__/maps.service.js) — estimativa sempre 10km/20min.',
                    'Distância real acumulada via haversine real sobre pontos de GPS emitidos por socket real.',
                    'paymentMethod=pix: sem gateway externo (Asaas confirmado sem callers na auditoria financeira) — cash/pix já são o fluxo real de produção.',
                ],
            });

            expect(problems).toEqual([]);
            expect(dispatchedOk).toBe(true);
            expect(recalculated).toBe(true);
            expect(cheaperAsExpected).toBe(true);
            expect(commissionOk).toBe(true);
            expect(earningsOk).toBe(true);
            expect(txTypesOk).toBe(true);
        } finally {
            await sim.stop();
        }
    }, 30000);
});
