// SIMULADOR E2E MOVECITY — Cenário 2: encomenda imediata.
//
// Mesmo princípio do Cenário 1 (ride.immediate.test.js): fluxo 100% real (HTTP real,
// Socket.IO real, parcel.service/wallet.service reais). Ver o comentário no topo
// daquele arquivo sobre por que `jest.mock('../../services/maps.service')` precisa
// estar no topo DESTE arquivo (hoisting) — setup.js chama o mesmo jest.mock dentro de
// um beforeAll que roda tarde demais pra qualquer arquivo que já tenha requerido
// app.js no próprio topo.
//
// Achado relevante (ver socket.js, handler 'update-location-captain'): encomendas NÃO
// acumulam distância real por GPS como corridas acumulam — o branch `else if (parcel)`
// só reemite a localização, sem `$inc` de distância. Por isso este cenário NÃO testa
// divergência estimativa×real de distância (não existe essa mecânica pra encomenda) —
// testa o ciclo completo de status + PIN de entrega + liquidação financeira real.
jest.mock('../../services/maps.service');

const parcelModel = require('../../models/parcel.model');
const captainModel = require('../../models/captain.model');
const { seedCarCategory } = require('./helpers/seedPricing');
const { createSimUser, createSimCaptain } = require('./helpers/testActors');
const { startSimServer, generateAuthToken } = require('./helpers/simSetup');
const { driveRoute } = require('./helpers/gpsRoute');
const { readWalletSnapshot, readTransactions } = require('./helpers/financialAssertions');
const { printScenarioReport } = require('./helpers/report');

describe('SIMULADOR E2E — Cenário 2: encomenda imediata', () => {
    it('percorre todo o ciclo real de uma encomenda imediata e fecha as contas', async () => {
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
            step('Motorista conecta e autentica via socket real (join)', true);

            await driveRoute({ socket: captainSocket, points: [pickupPoint], expectEcho: false });
            step('Motorista emite fix de GPS real (fixa location/locationGeoJSON)', true);

            const toggleRes = await sim.request(sim.app)
                .post('/captains/toggle-online')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ isOnline: true });
            step('POST /captains/toggle-online', toggleRes.statusCode === 200, `status ${toggleRes.statusCode}`);
            if (toggleRes.statusCode !== 200) problems.push({ severity: '🔴', description: `toggle-online falhou: ${JSON.stringify(toggleRes.body)}` });

            const newParcelEvent = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Timeout esperando new-parcel via socket')), 5000);
                captainSocket.once('new-parcel', (payload) => { clearTimeout(timer); resolve(payload); });
            });

            const createRes = await sim.request(sim.app)
                .post('/parcels/create')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    pickup: 'Avenida Paulista, São Paulo',
                    destination: 'Avenida Brigadeira Faria Lima, São Paulo',
                    vehicleType: 'car',
                    sender: { name: 'Remetente SIMULATOR', phone: '+5511900000001' },
                    recipient: { name: 'Destinatário SIMULATOR', phone: '+5511900000002' },
                    itemName: 'Pacote de simulação E2E',
                    category: 'outros',
                    weightKg: 3,
                    size: 'small',
                    paymentMethod: 'pix',
                });
            step('POST /parcels/create (passageiro)', createRes.statusCode === 201, `status ${createRes.statusCode}`);
            if (createRes.statusCode !== 201) {
                problems.push({ severity: '🔴', description: `Falha ao criar encomenda: ${JSON.stringify(createRes.body)}` });
                throw new Error('Não foi possível criar a encomenda — abortando cenário.');
            }
            const parcelId = createRes.body._id;
            const estimatedFare = createRes.body.fare;
            const estimatedDistance = createRes.body.estimatedDistance;
            const commissionAmount = createRes.body.commissionAmount;
            const commissionPercent = createRes.body.commissionPercent;
            const deliveryPin = createRes.body.deliveryPin;

            const dispatchPayload = await newParcelEvent;
            const dispatchedOk = String(dispatchPayload?._id) === String(parcelId);
            step("Despacho real via Socket.IO ('new-parcel' chega no motorista candidato)", dispatchedOk, `parcelId recebido=${dispatchPayload?._id}`);
            if (!dispatchedOk) problems.push({ severity: '🔴', description: 'Motorista online no raio não recebeu o evento new-parcel real.' });

            step('PIN de entrega real lido da resposta de criação (select +deliveryPin)', Boolean(deliveryPin && deliveryPin.length === 4));

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
                if (res.statusCode !== 200) problems.push({ severity: '🔴', description: `Transição para ${status} falhou: ${JSON.stringify(res.body)}` });
            }

            // PIN errado primeiro — prova que a validação real de segurança está ativa.
            const wrongPinRes = await sim.request(sim.app)
                .post(`/parcels/${parcelId}/confirm-delivery`)
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ pin: '0000' });
            const wrongPinRejected = wrongPinRes.statusCode === 400;
            step('POST /parcels/:id/confirm-delivery com PIN errado é rejeitado', wrongPinRejected, `status ${wrongPinRes.statusCode}`);
            if (!wrongPinRejected) problems.push({ severity: '🔴', description: `PIN errado não foi rejeitado: ${JSON.stringify(wrongPinRes.body)}` });

            const deliverRes = await sim.request(sim.app)
                .post(`/parcels/${parcelId}/confirm-delivery`)
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ pin: deliveryPin });
            step('POST /parcels/:id/confirm-delivery (PIN real)', deliverRes.statusCode === 200, `status ${deliverRes.statusCode}`);

            const parcelAfterDelivery = await parcelModel.findById(parcelId);
            const jumpedToFinished = parcelAfterDelivery.status === 'finished';
            step("confirmDelivery transiciona atomicamente para 'finished'", jumpedToFinished, `status=${parcelAfterDelivery.status}`);

            const walletBefore = await readWalletSnapshot(captain._id);

            const confirmPaymentRes = await sim.request(sim.app)
                .post(`/parcels/${parcelId}/confirm-payment`)
                .set('Authorization', `Bearer ${captainToken}`);
            step('POST /parcels/:id/confirm-payment', confirmPaymentRes.statusCode === 200, `status ${confirmPaymentRes.statusCode}`);

            // Idempotência: confirmar pagamento 2x não pode duplicar transação/crédito.
            const confirmPaymentAgainRes = await sim.request(sim.app)
                .post(`/parcels/${parcelId}/confirm-payment`)
                .set('Authorization', `Bearer ${captainToken}`);
            const secondConfirmRejected = confirmPaymentAgainRes.statusCode >= 400;
            step('Confirmar pagamento 2x é rejeitado (idempotência real)', secondConfirmRejected, `status ${confirmPaymentAgainRes.statusCode}`);
            if (!secondConfirmRejected) problems.push({ severity: '🔴', description: 'confirm-payment permitiu confirmação duplicada.' });

            const walletAfter = await readWalletSnapshot(captain._id);
            const finalParcel = await parcelModel.findById(parcelId);
            const captainAfter = await captainModel.findById(captain._id).select('earnings totalRides');
            const txs = await readTransactions({ captainId: captain._id, parcelId });

            const expectedCommission = finalParcel.commissionAmount;
            const creditDelta = Number((walletAfter.creditBalance - walletBefore.creditBalance).toFixed(2));
            const commissionOk = Math.abs(creditDelta + expectedCommission) < 0.01;
            step('Comissão debitada da carteira bate com o fare da encomenda', commissionOk, `delta=${creditDelta} esperado=${-expectedCommission}`);
            if (!commissionOk) problems.push({ severity: '🔴', description: `Comissão debitada (${creditDelta}) não bate com commissionAmount (${expectedCommission}).` });

            const earningsOk = captainAfter.earnings === finalParcel.fare;
            step('captain.earnings creditado com o fare real da encomenda', earningsOk, `earnings=${captainAfter.earnings} fare=${finalParcel.fare}`);

            const txTypesOk = txs.some(t => t.type === 'parcel_payment') && txs.some(t => t.type === 'commission');
            step('Transações reais gravadas (parcel_payment + commission)', txTypesOk, `tipos=${txs.map(t => t.type).join(',')}`);

            // Índice único parcial captain_active_parcel_unique/user_active_parcel_unique
            // (parcel.model.js) — encomenda finalizada não deve mais contar como "ativa".
            const stillCountsAsActive = await parcelModel.exists({
                _id: parcelId,
                status: { $in: ['awaiting_provider', 'provider_accepted', 'going_to_pickup', 'arrived_pickup', 'collected', 'in_transit', 'arrived_destination'] },
            });
            step('Encomenda finalizada não conta mais como ativa (índice único liberado)', !stillCountsAsActive);

            const status = problems.length === 0 ? 'PASS' : 'FAIL';
            printScenarioReport({
                title: 'CENÁRIO 2 — ENCOMENDA IMEDIATA',
                status,
                steps,
                metrics: {
                    parcelId,
                    'estimativa (fare)': estimatedFare,
                    'estimativa (distância)': `${estimatedDistance}m`,
                    'PIN de entrega': deliveryPin,
                    'comissão (%)': commissionPercent,
                    'comissão (R$)': expectedCommission,
                    'carteira do motorista (delta creditBalance)': creditDelta,
                },
                problems,
                notes: [
                    'Geocoding de endereço mockado (services/__mocks__/maps.service.js) — estimativa sempre 10km/20min.',
                    'Encomendas não recalculam fare por distância real de GPS (característica real do sistema, não lacuna do simulador) — o fare cobrado é o estimado na criação.',
                    'confirmDelivery pula "delivered" e vai direto pra "finished" — comportamento real confirmado em parcel.service.js, não um artefato do simulador.',
                ],
            });

            expect(problems).toEqual([]);
            expect(dispatchedOk).toBe(true);
            expect(wrongPinRejected).toBe(true);
            expect(jumpedToFinished).toBe(true);
            expect(secondConfirmRejected).toBe(true);
            expect(commissionOk).toBe(true);
            expect(earningsOk).toBe(true);
            expect(txTypesOk).toBe(true);
        } finally {
            await sim.stop();
        }
    }, 30000);
});
