// SIMULADOR E2E MOVECITY — Cenário 4: encomenda agendada.
//
// Combina a técnica de agendamento do Cenário 3 (ride.scheduled.test.js) com o fluxo
// de encomenda do Cenário 2 (parcel.immediate.test.js). Ativação via
// scheduleService.activateDueParcels() — a mesma função que o cron real chama.
jest.mock('../../services/maps.service');

const mongoose = require('mongoose');
const parcelModel = require('../../models/parcel.model');
const captainModel = require('../../models/captain.model');
const scheduleService = require('../../services/schedule.service');
const { seedCarCategory } = require('./helpers/seedPricing');
const { createSimUser, createSimCaptain } = require('./helpers/testActors');
const { startSimServer, generateAuthToken } = require('./helpers/simSetup');
const { driveRoute } = require('./helpers/gpsRoute');
const { readWalletSnapshot, readTransactions } = require('./helpers/financialAssertions');
const { printScenarioReport } = require('./helpers/report');

describe('SIMULADOR E2E — Cenário 4: encomenda agendada', () => {
    it('agenda, ativa via cron real e percorre o ciclo completo de uma encomenda agendada', async () => {
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
                .post('/parcels/create')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    pickup: 'Avenida Paulista, São Paulo',
                    destination: 'Avenida Brigadeira Faria Lima, São Paulo',
                    vehicleType: 'car',
                    sender: { name: 'Remetente SIMULATOR', phone: '+5511900000001' },
                    recipient: { name: 'Destinatário SIMULATOR', phone: '+5511900000002' },
                    itemName: 'Pacote agendado de simulação E2E',
                    category: 'outros',
                    weightKg: 3,
                    size: 'small',
                    paymentMethod: 'pix',
                    scheduledAt,
                });
            step('POST /parcels/create com scheduledAt (+16min, passa validação real de 15min mínimo)', createRes.statusCode === 201, `status ${createRes.statusCode}`);
            if (createRes.statusCode !== 201) {
                problems.push({ severity: '🔴', description: `Falha ao agendar encomenda: ${JSON.stringify(createRes.body)}` });
                throw new Error('Não foi possível agendar a encomenda — abortando cenário.');
            }
            const parcelId = createRes.body._id;
            const estimatedFare = createRes.body.fare;

            const scheduledDoc = await parcelModel.findById(parcelId).select('status scheduledAt');
            const isScheduled = scheduledDoc.status === 'scheduled';
            step("Encomenda fica em status 'scheduled', sem despacho no momento da criação", isScheduled, `status=${scheduledDoc.status}`);

            await parcelModel.collection.updateOne(
                { _id: new mongoose.Types.ObjectId(parcelId) },
                { $set: { scheduledAt: new Date(Date.now() + 5 * 60 * 1000) } }
            );
            step('Ajusta scheduledAt pra dentro da janela de ativação (técnica de schedule.phase1.test.js)', true);

            const newParcelEvent = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Timeout esperando new-parcel via socket')), 5000);
                captainSocket.once('new-parcel', (payload) => { clearTimeout(timer); resolve(payload); });
            });

            const activation = await scheduleService.activateDueParcels();
            step('scheduleService.activateDueParcels() (mesma função do cron real) ativa a encomenda', activation.activated === 1, `activated=${activation.activated} dispatch_count=${activation.dispatch_count}`);
            if (activation.activated !== 1) problems.push({ severity: '🔴', description: `activateDueParcels não ativou a encomenda agendada: ${JSON.stringify(activation)}` });

            const afterActivation = await parcelModel.findById(parcelId).select('status activatedAt');
            const activatedOk = afterActivation.status === 'awaiting_provider' && Boolean(afterActivation.activatedAt);
            step("Status transiciona scheduled → 'awaiting_provider' com activatedAt real", activatedOk, `status=${afterActivation.status} activatedAt=${afterActivation.activatedAt}`);

            const dispatchPayload = await newParcelEvent;
            const dispatchedOk = String(dispatchPayload?._id) === String(parcelId);
            step("Despacho real via Socket.IO na ativação ('new-parcel' chega no motorista)", dispatchedOk, `parcelId recebido=${dispatchPayload?._id}`);
            if (!dispatchedOk) problems.push({ severity: '🔴', description: 'Ativação não despachou via socket real para o motorista candidato.' });

            const parcelWithPin = await parcelModel.findById(parcelId).select('+deliveryPin');
            const deliveryPin = parcelWithPin.deliveryPin;

            const acceptRes = await sim.request(sim.app)
                .post(`/parcels/${parcelId}/accept`)
                .set('Authorization', `Bearer ${captainToken}`);
            step('POST /parcels/:id/accept', acceptRes.statusCode === 200, `status ${acceptRes.statusCode}`);

            for (const status of ['going_to_pickup', 'arrived_pickup', 'collected', 'in_transit', 'arrived_destination']) {
                // eslint-disable-next-line no-await-in-loop
                const res = await sim.request(sim.app)
                    .patch(`/parcels/${parcelId}/status`)
                    .set('Authorization', `Bearer ${captainToken}`)
                    .send({ status });
                step(`PATCH /parcels/:id/status (${status})`, res.statusCode === 200, `status ${res.statusCode}`);
            }

            // Comissão/repasse liquidam na própria confirmDelivery desde 2026-08-16 —
            // snapshot "before" vem antes.
            const walletBefore = await readWalletSnapshot(captain._id);

            const deliverRes = await sim.request(sim.app)
                .post(`/parcels/${parcelId}/confirm-delivery`)
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ pin: deliveryPin });
            step('POST /parcels/:id/confirm-delivery (PIN real)', deliverRes.statusCode === 200, `status ${deliverRes.statusCode}`);

            const walletAfter = await readWalletSnapshot(captain._id);

            // Liquidação já aconteceu no confirm-delivery acima — este toque manual
            // agora só existe como fallback e é corretamente rejeitado (já confirmado).
            const confirmPaymentRes = await sim.request(sim.app)
                .post(`/parcels/${parcelId}/confirm-payment`)
                .set('Authorization', `Bearer ${captainToken}`);
            step('POST /parcels/:id/confirm-payment (rejeitado — liquidação já aconteceu no confirm-delivery)', confirmPaymentRes.statusCode >= 400, `status ${confirmPaymentRes.statusCode}`);
            const finalParcel = await parcelModel.findById(parcelId);
            const captainAfter = await captainModel.findById(captain._id).select('earnings');
            const txs = await readTransactions({ captainId: captain._id, parcelId });

            const creditDelta = Number((walletAfter.creditBalance - walletBefore.creditBalance).toFixed(2));
            const commissionOk = Math.abs(creditDelta + finalParcel.commissionAmount) < 0.01;
            step('Comissão debitada bate com o fare da encomenda agendada', commissionOk, `delta=${creditDelta} esperado=${-finalParcel.commissionAmount}`);

            const earningsOk = captainAfter.earnings === finalParcel.fare;
            step('captain.earnings creditado com o fare real', earningsOk, `earnings=${captainAfter.earnings} fare=${finalParcel.fare}`);

            const txTypesOk = txs.some(t => t.type === 'parcel_payment') && txs.some(t => t.type === 'commission');
            step('Transações reais gravadas (parcel_payment + commission)', txTypesOk, `tipos=${txs.map(t => t.type).join(',')}`);

            if (!commissionOk) problems.push({ severity: '🔴', description: `Comissão pós-ativação (${creditDelta}) não bate com o esperado (${-finalParcel.commissionAmount}).` });
            if (!earningsOk) problems.push({ severity: '🔴', description: `captain.earnings (${captainAfter.earnings}) não bate com fare (${finalParcel.fare}).` });
            if (!txTypesOk) problems.push({ severity: '🔴', description: 'Transações reais de pagamento/comissão não encontradas.' });

            const status = problems.length === 0 ? 'PASS' : 'FAIL';
            printScenarioReport({
                title: 'CENÁRIO 4 — ENCOMENDA AGENDADA',
                status,
                steps,
                metrics: {
                    parcelId,
                    'agendada para (original)': scheduledAt,
                    'estimativa (fare, congelada no booking)': estimatedFare,
                    'fare final cobrado': finalParcel.fare,
                    'comissão (R$)': finalParcel.commissionAmount,
                    'carteira do motorista (delta creditBalance)': creditDelta,
                },
                problems,
                notes: [
                    'Ativação via scheduleService.activateDueParcels() — a mesma função que o cron de produção chama, não uma reimplementação paralela.',
                    'scheduledAt adiantado via update direto no Mongo só pra cair na janela de ativação sem esperar 16 minutos reais — mesma técnica de tests/unit/schedule.phase1.test.js.',
                    'Encomendas não recalculam fare por distância real de GPS (mesma característica real observada no Cenário 2).',
                ],
            });

            expect(problems).toEqual([]);
            expect(isScheduled).toBe(true);
            expect(activatedOk).toBe(true);
            expect(dispatchedOk).toBe(true);
        } finally {
            await sim.stop();
        }
    }, 30000);
});
