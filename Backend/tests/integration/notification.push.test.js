const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../../app');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const vehicleCategoryModel = require('../../models/vehicleCategory.model');
const NotificationToken = require('../../models/notificationToken.model');
const Notification = require('../../models/notification.model');
const NotificationCampaign = require('../../models/notificationCampaign.model');
const notificationDispatcher = require('../../notification/notificationDispatcher.service');
const adminUserModel = require('../../models/adminUser.model');

// M3/M4 da auditoria de push (2026-08-02): o envio passa por uma fila desacoplada do
// request (queue.service.js) e o histórico começa em status:'sending' antes de virar
// 'sent'/'failed' (notificationDispatcher.service.js: recordAndSend) — então a
// notificação não existe garantidamente (nem no estado final) no instante em que a
// resposta HTTP chega. Usado por todos os testes desta Fase que verificam o resultado
// de um envio disparado por um evento HTTP/socket.
const waitFor = async (queryFn, { requireFinal = false, attempts = 30, delayMs = 100 } = {}) => {
    for (let i = 0; i < attempts; i++) {
        const found = await queryFn();
        if (found && (!requireFinal || found.status !== 'sending')) return found;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
};

// Auditoria e correção do sistema de notificações push (2026-08-02) — Fase 1
// (C1/C2/C3/C5). Cobre o fluxo real de "passageiro cria corrida -> motorista compatível
// é despachado -> notificação de push é registrada e enviada", sem mocks de negócio: o
// motorista, o token FCM, a corrida e o despacho geográfico passam pelo endpoint e pelo
// banco reais (MongoMemoryReplSet). O único ponto necessariamente fora de alcance de um
// teste de backend automatizado é a ENTREGA física ao dispositivo — isso depende de um
// navegador real e de credenciais reais do Firebase, e é verificado por leitura de
// código nesta etapa (fcm.js registra o worker explícito, swCommunication.js usa a
// registration correta) mais o build do frontend passando.
describe('Fluxo de push de nova corrida (Fase 1: C1, C2, C3, C5)', () => {
    beforeEach(async () => {
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

    it('registra o token do motorista, despacha a corrida e grava a notificação — sem derrubar a criação da corrida mesmo com o Firebase indisponível', async () => {
        // Coordenadas batem com o mock de geocoding em services/__mocks__/maps.service.js
        // (getAddressCoordinate sempre resolve pra -23.550520,-46.633308) — o motorista
        // precisa estar dentro do raio de despacho de 15km a partir daí.
        const captain = await createCaptain({
            isOnline: true,
            socketId: 'socket-push-test',
            // Separação disponibilidade x conexão (2026-08-03): o despacho passou a
            // exigir contato recente (lastSeenAt) no lugar de socket vivo — ver
            // captain.service.js: availabilityFilter.
            lastSeenAt: new Date(),
            location: { ltd: -23.5505, lng: -46.6333 },
            locationGeoJSON: { type: 'Point', coordinates: [-46.6333, -23.5505] },
            vehicle: { color: 'Prata', plate: 'PSH1234', capacity: 4, vehicleType: 'car' }
        });
        const user = await createUser();
        const captainToken = generateAuthToken(captain, 'captain');
        const userToken = generateAuthToken(user, 'user');

        // C3/A4: exatamente a chamada real que frontend/src/services/fcm.js faz depois
        // de registrar o Service Worker e obter o token do Firebase.
        const fakeFcmToken = `fcm-test-token-${Date.now()}`;
        const registerRes = await request(app)
            .post('/notifications/token')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ token: fakeFcmToken, device: 'integration-test' });

        expect(registerRes.statusCode).toBe(200);

        const savedToken = await NotificationToken.findOne({ token: fakeFcmToken });
        expect(savedToken).toBeTruthy();
        expect(savedToken.captainId.toString()).toBe(captain._id.toString());
        expect(savedToken.userId).toBeFalsy();

        // Dispara o fluxo real de criação + despacho de corrida.
        const rideRes = await request(app)
            .post('/rides/create')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
                pickup: 'Avenida Paulista, 1000',
                destination: 'Avenida Faria Lima, 2000',
                vehicleType: 'car',
                paymentMethod: 'pix'
            });

        // C5: mesmo sem credenciais reais do Firebase configuradas neste ambiente de
        // teste (o app real de firebase-admin nunca foi inicializado — ver
        // config/firebase-admin.js), a criação da corrida tem que responder 201. Antes
        // desta correção, uma falha aqui dentro virava unhandled rejection.
        expect(rideRes.statusCode).toBe(201);

        const notification = await waitFor(
            () => Notification.findOne({ captainId: captain._id, type: 'NEW_RIDE' }),
            { requireFinal: true }
        );
        expect(notification).toBeTruthy();
        // Diagnóstico de push de corrida (2026-08-03): título/formato atualizados.
        expect(notification.title).toBe('🚗 Nova corrida disponível');
        // O envio real ao Firebase falha neste ambiente (sem credenciais) mesmo depois
        // dos retries do pushTransport — o status final gravado tem que refletir isso
        // (M4 da auditoria: antes gravava 'sent' incondicionalmente, mesmo sem entregar).
        expect(notification.status).toBe('failed');
    });

    // Nota: a filtragem geográfica em si (motorista fora do raio não é candidato) já tem
    // cobertura própria em ride.api.test.js via getCaptainsInTheRadius — não duplicado
    // aqui. Uma segunda variante deste teste com dois motoristas foi tentada e removida:
    // falhava por um cache em memória de services/cache/cache.js (chave por coordenada,
    // TTL de 10s) que não é limpo entre testes do mesmo arquivo — só o Mongo é (via
    // clearDatabase() no afterEach global). É uma lacuna pré-existente da infraestrutura
    // de teste, não relacionada a esta correção; registrado aqui para não se perder.
});

describe('Segurança e segmentação de tokens de notificação (Fase 2: C4, A3, A4)', () => {
    it('C4: registerToken nunca grava null no campo que não se aplica, e a segmentação de sendAdminNotification não vaza entre públicos', async () => {
        const passenger = await createUser();
        const captain = await createCaptain();
        const passengerToken = generateAuthToken(passenger, 'user');
        const captainToken = generateAuthToken(captain, 'captain');

        await request(app)
            .post('/notifications/token')
            .set('Authorization', `Bearer ${passengerToken}`)
            .send({ token: 'tok-passageiro-c4', device: 'test' })
            .expect(200);

        await request(app)
            .post('/notifications/token')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ token: 'tok-motorista-c4', device: 'test' })
            .expect(200);

        const passengerDoc = await NotificationToken.findOne({ token: 'tok-passageiro-c4' }).lean();
        const captainDoc = await NotificationToken.findOne({ token: 'tok-motorista-c4' }).lean();

        // Antes da correção, os dois campos existiam sempre (um deles null). Agora o
        // campo que não se aplica nem existe no documento.
        expect('captainId' in passengerDoc).toBe(false);
        expect('userId' in captainDoc).toBe(false);

        // Mesma consulta usada por sendAdminNotification em notification.service.js.
        const passengerTargetedTokens = await NotificationToken.find({ userId: { $ne: null } }).lean();
        const driverTargetedTokens = await NotificationToken.find({ captainId: { $ne: null } }).lean();

        expect(passengerTargetedTokens.map(t => t.token)).toContain('tok-passageiro-c4');
        expect(passengerTargetedTokens.map(t => t.token)).not.toContain('tok-motorista-c4');
        expect(driverTargetedTokens.map(t => t.token)).toContain('tok-motorista-c4');
        expect(driverTargetedTokens.map(t => t.token)).not.toContain('tok-passageiro-c4');
    });

    it('A3/A4: DELETE /notifications/token só remove o vínculo de quem realmente é dono do token', async () => {
        const captain = await createCaptain();
        const otherCaptain = await createCaptain();
        const captainToken = generateAuthToken(captain, 'captain');
        const otherToken = generateAuthToken(otherCaptain, 'captain');

        await NotificationToken.create({ captainId: captain._id, token: 'tok-a3', device: 'test' });

        // Outra conta não consegue apagar um token que não é dela.
        await request(app)
            .delete('/notifications/token')
            .set('Authorization', `Bearer ${otherToken}`)
            .query({ token: 'tok-a3' })
            .expect(200);
        expect(await NotificationToken.findOne({ token: 'tok-a3' })).toBeTruthy();

        // O dono de verdade consegue — é o que UserLogout.jsx/CaptainLogout.jsx chamam.
        await request(app)
            .delete('/notifications/token')
            .set('Authorization', `Bearer ${captainToken}`)
            .query({ token: 'tok-a3' })
            .expect(200);
        expect(await NotificationToken.findOne({ token: 'tok-a3' })).toBeFalsy();
    });

    it('A4: registrar um token já existente de outro dono reatribui (dispositivo compartilhado) sem duplicar o documento', async () => {
        const firstCaptain = await createCaptain();
        const secondCaptain = await createCaptain();
        const firstToken = generateAuthToken(firstCaptain, 'captain');
        const secondToken = generateAuthToken(secondCaptain, 'captain');

        await request(app)
            .post('/notifications/token')
            .set('Authorization', `Bearer ${firstToken}`)
            .send({ token: 'tok-compartilhado', device: 'test' })
            .expect(200);

        await request(app)
            .post('/notifications/token')
            .set('Authorization', `Bearer ${secondToken}`)
            .send({ token: 'tok-compartilhado', device: 'test' })
            .expect(200);

        const docs = await NotificationToken.find({ token: 'tok-compartilhado' }).lean();
        expect(docs.length).toBe(1);
        expect(docs[0].captainId.toString()).toBe(secondCaptain._id.toString());
    });
});

describe('Fase 4: reestruturação do serviço de push (M1)', () => {
    it('duas chamadas concorrentes de processCampaign na mesma campanha só processam uma vez', async () => {
        const passenger = await createUser();
        const passengerToken = generateAuthToken(passenger, 'user');

        await request(app)
            .post('/notifications/token')
            .set('Authorization', `Bearer ${passengerToken}`)
            .send({ token: 'tok-campaign-m1', device: 'test' })
            .expect(200);

        // M1 da auditoria de push (2026-08-02): com duas instâncias do backend (ou o
        // cron disparando de novo antes do processamento anterior terminar), a mesma
        // campanha podia ser enviada duas vezes. Simula exatamente essa corrida:
        // processCampaign chamado duas vezes ao mesmo tempo para a mesma campanha.
        const campaign = await NotificationCampaign.create({
            title: 'Promo M1',
            message: 'Teste de concorrência no processamento de campanha',
            targetRules: { audienceType: 'passengers' },
            status: 'scheduled',
            adminId: new mongoose.Types.ObjectId()
        });

        await Promise.all([
            notificationDispatcher.processCampaign(campaign._id),
            notificationDispatcher.processCampaign(campaign._id)
        ]);

        const finalCampaign = await NotificationCampaign.findById(campaign._id);
        expect(finalCampaign.status).toBe('completed');
        // Se as duas chamadas tivessem processado, "sent" contaria o único destinatário
        // duas vezes (2), não uma (1) — o lock atômico garante que só uma "vence".
        expect(finalCampaign.metrics.sent).toBe(1);
    });
});

describe('Fase 5: correções de funcionalidade (A5, A6, pagamento, carteira)', () => {
    beforeEach(async () => {
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

    it('A5: "motorista chegou" gera push para o passageiro', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted', otp: '111222' });
        const captainToken = generateAuthToken(captain, 'captain');
        const userToken = generateAuthToken(user, 'user');

        await request(app)
            .post('/notifications/token')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ token: 'tok-a5-user', device: 'test' })
            .expect(200);

        const res = await request(app)
            .post('/rides/update-status')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ rideId: ride._id.toString(), status: 'arrived' });

        expect(res.statusCode).toBe(200);

        // Antes desta correção, "motorista chegou" só emitia socket — sem push, um
        // passageiro com o app em segundo plano nunca sabia que o carro tinha chegado.
        const notification = await waitFor(
            () => Notification.findOne({ userId: user._id, type: 'RIDE_ARRIVED' }),
            { requireFinal: true }
        );
        expect(notification).toBeTruthy();
        expect(notification.title).toBe('Seu motorista chegou!');
    });

    it('A6: passageiro cancelar uma corrida já aceita gera push direto para o motorista designado', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted' });
        const userToken = generateAuthToken(user, 'user');
        const captainToken = generateAuthToken(captain, 'captain');

        await request(app)
            .post('/notifications/token')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ token: 'tok-a6-captain', device: 'test' })
            .expect(200);

        const res = await request(app)
            .post('/rides/cancel')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ rideId: ride._id.toString() });

        expect(res.statusCode).toBe(200);

        // Antes: só sendMessageToRoom('ride_<id>'), que depende da sala ainda ter o
        // socketId certo — um motorista que reconectou entre o despacho e agora nunca
        // recebia o aviso de forma confiável.
        const notification = await waitFor(
            () => Notification.findOne({ captainId: captain._id, type: 'RIDE_CANCELLED' }),
            { requireFinal: true }
        );
        expect(notification).toBeTruthy();
    });

    it('cancelar uma corrida ainda sem motorista designado (requested) não tenta notificar ninguém por push', async () => {
        const user = await createUser();
        const ride = await createRide({ user: user._id, captain: undefined, status: 'requested' });
        const userToken = generateAuthToken(user, 'user');

        const res = await request(app)
            .post('/rides/cancel')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ rideId: ride._id.toString() });

        expect(res.statusCode).toBe(200);

        const notification = await Notification.findOne({ type: 'RIDE_CANCELLED' });
        expect(notification).toBeFalsy();
    });

    it('Pagamento: passageiro pagar a corrida gera push para o motorista', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({
            user: user._id, captain: captain._id, status: 'finished',
            paymentMethod: 'carteira', fare: 30, finalPrice: 30
        });
        const userToken = generateAuthToken(user, 'user');
        const captainToken = generateAuthToken(captain, 'captain');

        await request(app)
            .post('/notifications/token')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ token: 'tok-payment-captain', device: 'test' })
            .expect(200);

        const res = await request(app)
            .post('/rides/pay')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ rideId: ride._id.toString() });

        expect(res.statusCode).toBe(200);

        const notification = await waitFor(
            () => Notification.findOne({ captainId: captain._id, type: 'PAYMENT' }),
            { requireFinal: true }
        );
        expect(notification).toBeTruthy();
    });

    it('Carteira: uma recarga aprovada gera push para o motorista (sendRechargeApproved finalmente é chamada)', async () => {
        const captain = await createCaptain();
        const captainToken = generateAuthToken(captain, 'captain');

        await request(app)
            .post('/notifications/token')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ token: 'tok-recharge-captain', device: 'test' })
            .expect(200);

        // Mesmo ponto único de movimentação de carteira usado por todo o resto do
        // sistema (admin.service.js, webhook.controller.js) — não um atalho de teste.
        const walletService = require('../../services/wallet.service');
        await walletService.createTransaction({
            captainId: captain._id,
            type: 'recharge',
            amount: 50,
            description: 'Recarga via Pix'
        });

        // M11 da auditoria original: sendRechargeApproved existia desde sempre mas
        // nunca era chamada em lugar nenhum — código morto. Agora é.
        const notification = await waitFor(
            () => Notification.findOne({ captainId: captain._id, type: 'RECHARGE' }),
            { requireFinal: true }
        );
        expect(notification).toBeTruthy();
    });
});

describe('Fase 7: canal de push para o admin', () => {
    const createAdmin = async (overrides = {}) => adminUserModel.create({
        name: 'Admin Teste',
        email: `admin_${Date.now()}_${Math.random()}@test.com`,
        password: 'password123',
        role: 'super_admin',
        ...overrides
    });

    it('admin registra o próprio token via POST /admin/notifications/token, sem userId/captainId', async () => {
        const admin = await createAdmin();
        const adminToken = generateAuthToken(admin, 'admin');

        await request(app)
            .post('/api/admin/notifications/token')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ token: 'tok-admin-1', device: 'test' })
            .expect(200);

        const doc = await NotificationToken.findOne({ token: 'tok-admin-1' }).lean();
        expect(doc.adminId.toString()).toBe(admin._id.toString());
        expect('userId' in doc).toBe(false);
        expect('captainId' in doc).toBe(false);
    });

    it('novo motorista se cadastrando gera alerta para os admins', async () => {
        await vehicleCategoryModel.create({
            name: 'car', displayName: 'Carro', baseFare: 5, perKmRate: 1.5,
            perMinuteRate: 0.3, minFare: 8, isActive: true
        });
        const admin = await createAdmin();
        const adminToken = generateAuthToken(admin, 'admin');
        await request(app)
            .post('/api/admin/notifications/token')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ token: 'tok-admin-newcaptain', device: 'test' })
            .expect(200);

        const res = await request(app)
            .post('/captains/register')
            .send({
                fullname: { firstname: 'Novo', lastname: 'Motorista' },
                email: `novo_motorista_${Date.now()}@test.com`,
                password: 'password123',
                cpf: '12345678901',
                phone: '+5511988887777',
                birthDate: '1990-01-01',
                cnh: { number: '123456', category: 'AB', expiration: '2030-01-01', uf: 'SP', ear: false },
                pix: { keyType: 'email', key: 'novo@test.com' },
                vehicle: { marca: 'Fiat', modelo: 'Uno', ano: 2020, color: 'Prata', plate: 'NEW1234', capacity: 4, vehicleType: 'car' }
            });

        expect(res.statusCode).toBe(201);

        const notification = await waitFor(
            () => Notification.findOne({ type: 'ADMIN', targetAudience: 'admins' }),
            { requireFinal: true }
        );
        expect(notification).toBeTruthy();
        expect(notification.title).toBe('Novo motorista aguardando aprovação');
    });

    it('denúncia numa avaliação (issueCategory preenchido) gera alerta para os admins', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'finished' });
        const userToken = generateAuthToken(user, 'user');
        const admin = await createAdmin();
        const adminToken = generateAuthToken(admin, 'admin');
        await request(app)
            .post('/api/admin/notifications/token')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ token: 'tok-admin-complaint', device: 'test' })
            .expect(200);

        const res = await request(app)
            .post('/rides/review')
            .set('Authorization', `Bearer ${userToken}`)
            // Valores reais do enum em ride.routes.js (body('issueCategory').isIn([...])).
            .send({ rideId: ride._id.toString(), rating: 1, comment: 'Motorista foi grosseiro', issueCategory: 'behavior' });

        expect(res.statusCode).toBe(201);

        const notification = await waitFor(
            () => Notification.findOne({ type: 'ADMIN', targetAudience: 'admins' }),
            { requireFinal: true }
        );
        expect(notification).toBeTruthy();
        expect(notification.title).toBe('Denúncia registrada em uma corrida');
    });

    it('avaliação SEM issueCategory não gera alerta nenhum (não é denúncia)', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'finished' });
        const userToken = generateAuthToken(user, 'user');

        const res = await request(app)
            .post('/rides/review')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ rideId: ride._id.toString(), rating: 5 });

        expect(res.statusCode).toBe(201);

        const notification = await Notification.findOne({ type: 'ADMIN', targetAudience: 'admins' });
        expect(notification).toBeFalsy();
    });

    it('avaliação com issueCategory:"none" (sem problema) não gera alerta — "none" é um valor válido do enum, não uma denúncia', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'finished' });
        const userToken = generateAuthToken(user, 'user');

        const res = await request(app)
            .post('/rides/review')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ rideId: ride._id.toString(), rating: 5, issueCategory: 'none' });

        expect(res.statusCode).toBe(201);

        const notification = await Notification.findOne({ type: 'ADMIN', targetAudience: 'admins' });
        expect(notification).toBeFalsy();
    });

    it('webhook do Asaas reportando pagamento vencido gera alerta para os admins', async () => {
        const originalToken = process.env.ASAAS_WEBHOOK_TOKEN;
        process.env.ASAAS_WEBHOOK_TOKEN = 'test-webhook-secret-fase7';

        try {
            const admin = await createAdmin();
            const adminToken = generateAuthToken(admin, 'admin');
            await request(app)
                .post('/api/admin/notifications/token')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ token: 'tok-admin-payment-problem', device: 'test' })
                .expect(200);

            const res = await request(app)
                .post('/webhooks/asaas')
                .set('asaas-access-token', 'test-webhook-secret-fase7')
                .send({ event: 'PAYMENT_OVERDUE', payment: { id: 'pay_overdue_test' } });

            expect(res.statusCode).toBe(200);

            const notification = await waitFor(
                () => Notification.findOne({ type: 'ADMIN', targetAudience: 'admins' }),
                { requireFinal: true }
            );
            expect(notification).toBeTruthy();
            expect(notification.title).toBe('Problema de pagamento');
        } finally {
            process.env.ASAAS_WEBHOOK_TOKEN = originalToken;
        }
    });
});

// Auditoria final (Fase 8): M7 continuava aberto depois de todas as fases anteriores —
// o Service Worker mandava TODO clique de notificação para '/captain-home' quando não
// havia uma ação de aceite envolvida. Na prática, um passageiro tocando em "Corrida
// Aceita!" ia parar na tela inicial do MOTORISTA. A correção é o backend informar a
// rota certa em data.deepLink; estes testes garantem que ela é de fato enviada, porque
// o roteamento do lado do SW depende inteiramente disso.
describe('Fase 8 (auditoria final): deep link correto por destinatário (M7)', () => {
    const pushTransport = require('../../notification/pushTransport.service');

    // Intercepta o transporte pra inspecionar o payload REAL que iria ao Firebase.
    // Não substitui nenhuma regra de negócio: o dispatcher, o tokenRegistry e o banco
    // continuam sendo os de produção — só o envio ao Firebase (que não existe neste
    // ambiente) é observado em vez de tentado.
    let capturedPayloads;
    let originalSendPush;

    beforeEach(() => {
        capturedPayloads = [];
        originalSendPush = pushTransport.sendPush;
        pushTransport.sendPush = async (tokens, payload, traceId) => {
            capturedPayloads.push(payload);
            return { successCount: tokens.length, failureCount: 0, invalidTokens: [] };
        };
    });

    afterEach(() => {
        pushTransport.sendPush = originalSendPush;
    });

    const waitForPayload = async (attempts = 30, delayMs = 100) => {
        for (let i = 0; i < attempts; i++) {
            if (capturedPayloads.length > 0) return capturedPayloads[0];
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return null;
    };

    it('notificação de corrida para o PASSAGEIRO aponta para /riding, nunca para /captain-home', async () => {
        const user = await createUser();
        await NotificationToken.create({ userId: user._id, token: 'tok-deeplink-user', device: 'test' });

        notificationDispatcher.sendRideAccepted(user._id, { rideId: 'ride-123' });

        const payload = await waitForPayload();
        expect(payload).toBeTruthy();
        expect(payload.data.deepLink).toBe('/riding');
        expect(payload.data.deepLink).not.toBe('/captain-home');
    });

    it('"motorista chegou" também aponta para a tela do passageiro', async () => {
        const user = await createUser();
        await NotificationToken.create({ userId: user._id, token: 'tok-deeplink-arrived', device: 'test' });

        notificationDispatcher.sendCaptainArrived(user._id, { rideId: 'ride-124' });

        const payload = await waitForPayload();
        expect(payload.data.deepLink).toBe('/riding');
    });

    it('recarga aprovada leva o motorista para a carteira, não para a home', async () => {
        const captain = await createCaptain();
        await NotificationToken.create({ captainId: captain._id, token: 'tok-deeplink-recharge', device: 'test' });

        notificationDispatcher.sendRechargeApproved(captain._id, { transactionId: 't1', amount: 50 });

        const payload = await waitForPayload();
        expect(payload.data.deepLink).toBe('/captain/wallet');
    });

    it('nova corrida para o motorista aponta para /captain-home e carrega apiUrl para o aceite', async () => {
        const captain = await createCaptain();
        await NotificationToken.create({ captainId: captain._id, token: 'tok-deeplink-newride', device: 'test' });

        notificationDispatcher.sendNewRide(captain._id, { rideId: 'ride-125' });

        const payload = await waitForPayload();
        expect(payload.data.deepLink).toBe('/captain-home');
        expect(payload.data.apiUrl).toBeTruthy();
        // Fora de produção o aceite inline continua disponível.
        expect(payload.webpush.notification.actions).toBeTruthy();
    });

    it('em produção sem BASE_URL, a oferta de corrida NÃO oferece o botão "Aceitar" (que não teria como funcionar)', async () => {
        const originalEnv = process.env.NODE_ENV;
        const originalBaseUrl = process.env.BASE_URL;
        process.env.NODE_ENV = 'production';
        delete process.env.BASE_URL;

        try {
            const captain = await createCaptain();
            await NotificationToken.create({ captainId: captain._id, token: 'tok-deeplink-nobaseurl', device: 'test' });

            notificationDispatcher.sendNewRide(captain._id, { rideId: 'ride-126' });

            const payload = await waitForPayload();
            expect(payload.webpush.notification.actions).toBeUndefined();
            // A notificação em si continua sendo enviada — só a ação embutida some.
            expect(payload.title).toBe('🚗 Nova corrida disponível');
        } finally {
            process.env.NODE_ENV = originalEnv;
            if (originalBaseUrl === undefined) delete process.env.BASE_URL;
            else process.env.BASE_URL = originalBaseUrl;
        }
    });

    it('campanha traduz o deepLink lógico do painel para uma rota real com barra inicial', async () => {
        const user = await createUser();
        await NotificationToken.create({ userId: user._id, token: 'tok-deeplink-campaign', device: 'test' });

        const campaign = await NotificationCampaign.create({
            title: 'Cupom novo',
            message: 'Use o cupom X',
            deepLink: 'promotions',
            targetRules: { audienceType: 'passengers' },
            status: 'scheduled',
            adminId: new mongoose.Types.ObjectId()
        });

        await notificationDispatcher.processCampaign(campaign._id);

        const payload = await waitForPayload();
        // 'promotions' (nome lógico do painel) -> '/coupons' (rota real do app).
        expect(payload.data.deepLink).toBe('/coupons');
        expect(payload.data.deepLink.startsWith('/')).toBe(true);
    });
});
