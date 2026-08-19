// SIMULADOR E2E MOVECITY — Cenário 4: corrida presencial sem destino.
//
// Este é o fluxo PRINCIPAL da operação hoje (motorista pega passageiro na rua) e era o
// único sem cobertura ponta a ponta — achado P5 da auditoria do presencial (2026-08-19).
// Corrida despachada e encomenda tinham dois cenários cada; esta, nenhum.
//
// A variante escolhida é a mais exposta: SEM destino definido na criação. Aqui não existe
// estimativa para cair de volta — o preço nasce inteiro do GPS acumulado durante a
// viagem, e o destino é descoberto pela última posição válida. É o caminho onde
// PRICING_FAILED, INSUFFICIENT_TRIP_DISTANCE e STALE_FINISH_LOCATION vivem.
//
// Mesmo princípio de mock dos outros cenários — ver o topo de ride.immediate.test.js
// sobre o jest.mock precisar estar aqui no topo por ordem de require.
jest.mock('../../services/maps.service');

const rideModel = require('../../models/ride.model');
const captainModel = require('../../models/captain.model');
const { seedCarCategory } = require('./helpers/seedPricing');
const { createSimCaptain } = require('./helpers/testActors');
const { startSimServer, generateAuthToken } = require('./helpers/simSetup');
const { buildLinearRoute, driveRoute, routeTimeline } = require('./helpers/gpsRoute');
const { readWalletSnapshot, readTransactions } = require('./helpers/financialAssertions');
const { printScenarioReport } = require('./helpers/report');

describe('SIMULADOR E2E — Cenário 4: corrida presencial sem destino', () => {
    it('cria na rua, inicia por PIN, cobra pelo GPS real e liquida a comissão', async () => {
        const steps = [];
        const problems = [];
        const step = (label, ok, detail) => steps.push({ label, ok, detail });

        const sim = await startSimServer();
        try {
            await seedCarCategory();
            const captain = await createSimCaptain();
            const captainToken = generateAuthToken(captain, 'captain');
            step('Motorista SIMULATOR real no DB', true);

            const pickupPoint = { ltd: -23.550520, lng: -46.633308 };
            // ~1,2 km ao norte: distância real do percurso, que é a ÚNICA fonte de preço
            // nesta variante.
            //
            // O tamanho não é estético. O socket recusa GPS com mais de 2 min de idade
            // (MAX_LOCATION_AGE_MS), e a viagem simulada acontece toda no passado — a
            // 43 km/h, 1,2 km leva 100 s e cabe na janela. Uma rota de 4 km levaria 5,5 min
            // e os primeiros pontos chegariam vencidos, sem acumular distância nenhuma.
            const endPoint = { ltd: pickupPoint.ltd + 1.2 / 111.32, lng: pickupPoint.lng };

            const captainSocket = await sim.connectSocket();
            await sim.joinSocket(captainSocket, {
                userId: captain._id.toString(), userType: 'captain', token: captainToken,
            });
            // Fixa a posição real antes de criar: a origem da presencial sai daqui.
            await driveRoute({ socket: captainSocket, points: [pickupPoint], expectEcho: false });
            step('Motorista conecta, autentica e fixa GPS real', true);

            await sim.request(sim.app)
                .post('/captains/toggle-online')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ isOnline: true });

            // ---- criação na rua, sem destino ----
            const createRes = await sim.request(sim.app)
                .post('/rides/presential')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ destinationPending: true, paymentMethod: 'cash' });
            step('POST /rides/presential (sem destino)', createRes.statusCode === 201, `status ${createRes.statusCode}`);
            if (createRes.statusCode !== 201) {
                problems.push({ severity: '🔴', description: `Falha ao criar presencial: ${JSON.stringify(createRes.body)}` });
                throw new Error('Não foi possível criar a corrida presencial — abortando cenário.');
            }

            const rideId = createRes.body._id;
            const otp = createRes.body.otp;
            step('PIN volta pro motorista na criação (ele precisa informar ao passageiro)', Boolean(otp && otp.length === 6), `otp=${otp ? 'presente' : 'ausente'}`);

            const created = await rideModel.findById(rideId).select('status source fare destinationPending');
            const nasceAceita = created.status === 'accepted' && created.source === 'driver_initiated';
            step("Nasce em 'accepted' (espera o PIN), sem despacho", nasceAceita, `status=${created.status} source=${created.source}`);

            const semPrecoAntes = Number(created.fare) === 0 && created.destinationPending === true;
            step('Sem destino, nasce sem preço — nada de tarifa mínima inventada', semPrecoAntes, `fare=${created.fare} pending=${created.destinationPending}`);
            if (!semPrecoAntes) problems.push({ severity: '🔴', description: `Presencial sem destino nasceu com fare=${created.fare}; deveria ser 0 até o GPS decidir.` });

            // Ocupa o motorista: criar outra agora tem que ser recusado apontando a que existe.
            const duplicada = await sim.request(sim.app)
                .post('/rides/presential')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ destinationPending: true, paymentMethod: 'cash' });
            const apontaAAberta = duplicada.statusCode === 409
                && duplicada.body?.code === 'PRESENTIAL_ALREADY_OPEN'
                && String(duplicada.body?.rideId) === String(rideId);
            step('Recriar aponta a corrida já aberta, em vez de "você está ocupado"', apontaAAberta, `status ${duplicada.statusCode} code=${duplicada.body?.code}`);
            if (!apontaAAberta) problems.push({ severity: '🟡', description: `Segunda criação devolveu ${duplicada.statusCode}/${duplicada.body?.code} — o motorista não é levado de volta à corrida dele.` });

            // ---- PIN ----
            const startRes = await sim.request(sim.app)
                .get('/rides/start-ride')
                .set('Authorization', `Bearer ${captainToken}`)
                .query({ rideId, otp });
            step('GET /rides/start-ride com o PIN real', startRes.statusCode === 200, `status ${startRes.statusCode}`);

            // ---- percurso real ----
            // A linha do tempo termina agora e começa no passado (horário futuro é
            // recusado), então a corrida precisa ser alinhada a ela: início e âncora antes
            // do primeiro ponto. Sem isso os pontos chegam "fora de ordem" e a corrida
            // fecharia com distância zero — que nesta variante significa recusar o preço.
            const route = buildLinearRoute(pickupPoint, endPoint, { stepMeters: 300 });
            const timeline = routeTimeline(route);
            await rideModel.updateOne(
                { _id: rideId },
                {
                    $set: {
                        startedAt: new Date(timeline.startMs - 5000),
                        lastLocation: { lat: pickupPoint.ltd, lng: pickupPoint.lng },
                        lastLocationAt: new Date(timeline.startMs - 1000),
                    },
                }
            );
            await driveRoute({ socket: captainSocket, points: route, delayMs: 15, timeline });

            const afterDrive = await rideModel.findById(rideId).select('actualDistance');
            const actualDistance = afterDrive.actualDistance;
            const andouDeVerdade = actualDistance > 900;
            step('GPS real acumula o percurso (~1,2 km, socket real)', andouDeVerdade, `actualDistance=${actualDistance}m`);
            if (!andouDeVerdade) problems.push({ severity: '🔴', description: `Só ${actualDistance}m acumulados — sem distância real não há preço nesta variante.` });

            const walletBefore = await readWalletSnapshot(captain._id);

            // ---- finalização ----
            const endRes = await sim.request(sim.app)
                .post('/rides/end-ride')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId });
            step('POST /rides/end-ride', endRes.statusCode === 200, `status ${endRes.statusCode}`);
            if (endRes.statusCode !== 200) {
                problems.push({ severity: '🔴', description: `end-ride falhou: ${JSON.stringify(endRes.body)}` });
            }

            const finalRide = await rideModel.findById(rideId);
            const finalPrice = finalRide.finalPrice;

            const precoVeioDoGps = finalPrice > 0;
            step('Preço nasce do GPS (não havia estimativa pra cair de volta)', precoVeioDoGps, `finalPrice=${finalPrice}`);
            if (!precoVeioDoGps) problems.push({ severity: '🔴', description: 'Presencial sem destino fechou sem preço — deveria ter recusado a finalização em vez de cobrar zero.' });

            const destinoDescoberto = Boolean(finalRide.destination) && finalRide.destinationPending === false;
            step('Destino preenchido pela última posição válida', destinoDescoberto, `destination=${finalRide.destination || '(vazio)'}`);

            const walletAfter = await readWalletSnapshot(captain._id);
            const creditDelta = Number((walletAfter.creditBalance - walletBefore.creditBalance).toFixed(2));
            const comissaoOk = finalRide.commissionAmount > 0
                && Math.abs(creditDelta + finalRide.commissionAmount) < 0.01;
            step('Comissão debitada na própria finalização, batendo com o preço real', comissaoOk, `delta=${creditDelta} comissão=${finalRide.commissionAmount}`);
            if (!comissaoOk) problems.push({ severity: '🔴', description: `Comissão debitada (${creditDelta}) não bate com commissionAmount (${finalRide.commissionAmount}).` });

            const captainAfter = await captainModel.findById(captain._id).select('earnings');
            const ganhoOk = captainAfter.earnings === finalPrice;
            step('Ganho do motorista creditado com o valor real', ganhoOk, `earnings=${captainAfter.earnings} finalPrice=${finalPrice}`);

            const txs = await readTransactions({ captainId: captain._id, rideId });
            const txOk = txs.some((t) => t.type === 'commission');
            step('Transação de comissão gravada', txOk, `tipos=${txs.map((t) => t.type).join(',') || '(nenhuma)'}`);

            // Dinheiro em mãos: nada deve ficar pendente esperando um toque extra.
            const liquidada = finalRide.paymentStatus === 'paid';
            step('Finalizar já liquida — sem "pagamento recebido" pendente', liquidada, `paymentStatus=${finalRide.paymentStatus}`);
            if (!liquidada) problems.push({ severity: '🟡', description: `paymentStatus=${finalRide.paymentStatus} após finalizar; o motorista receberia em mãos e ficaria com pendência no app.` });

            const status = problems.length === 0 ? 'PASS' : 'FAIL';
            printScenarioReport({
                title: 'CENÁRIO 4 — CORRIDA PRESENCIAL SEM DESTINO',
                status,
                steps,
                metrics: {
                    rideId,
                    'distância real percorrida': `${actualDistance}m`,
                    'valor final cobrado': finalPrice,
                    'comissão (R$)': finalRide.commissionAmount,
                    'carteira do motorista (delta)': creditDelta,
                    'destino descoberto': finalRide.destination,
                },
                problems,
            });

            expect(problems).toEqual([]);
            captainSocket.close();
        } finally {
            await sim.stop();
        }
    }, 60000);
});
