const request = require('supertest');
const { createServer } = require('http');
const Client = require('socket.io-client');
const app = require('../../app');
const { initializeSocket } = require('../../socket');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const rideModel = require('../../models/ride.model');
const Notification = require('../../models/notification.model');
const NotificationToken = require('../../models/notificationToken.model');

// Implementação do sistema de cancelamento (2026-08-04). A máquina de estados em si
// (transições inválidas, corrida cancelar×iniciar concorrente, autorização por dono) já
// tem cobertura extensa em ride.api.test.js — não duplicado aqui. Este arquivo cobre
// especificamente o que foi adicionado agora: motivo obrigatório do motorista em
// arrived/waiting_passenger, campos de auditoria (cancelledBy/cancellationReason/
// cancelledAt/captainCancellations), a correção do canal de tempo real que não
// alcançava o passageiro, e a notificação push na direção que não existia.
const waitFor = async (queryFn, attempts = 30, delayMs = 100) => {
    for (let i = 0; i < attempts; i++) {
        const found = await queryFn();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
};

describe('Cancelamento — motivo obrigatório do motorista', () => {
    it('cancelar em "arrived" sem motivo é rejeitado com 400, corrida não muda', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const captainToken = generateAuthToken(captain, 'captain');
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'arrived', arrivedAt: new Date() });

        const res = await request(app)
            .post('/rides/captain-cancel')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ rideId: ride._id.toString() });

        expect(res.statusCode).toBe(400);

        const unchanged = await rideModel.findById(ride._id);
        expect(unchanged.status).toBe('arrived');
        expect(unchanged.captain.toString()).toBe(captain._id.toString());
    });

    it('cancelar em "waiting_passenger" sem motivo também é rejeitado', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const captainToken = generateAuthToken(captain, 'captain');
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'waiting_passenger', arrivedAt: new Date() });

        const res = await request(app)
            .post('/rides/captain-cancel')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ rideId: ride._id.toString() });

        expect(res.statusCode).toBe(400);
    });

    it('cancelar em "arrived" COM motivo funciona e o motivo fica registrado em captainCancellations', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const captainToken = generateAuthToken(captain, 'captain');
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'arrived', arrivedAt: new Date() });

        const res = await request(app)
            .post('/rides/captain-cancel')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ rideId: ride._id.toString(), reason: 'Passageiro não apareceu' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('requested');

        const persisted = await rideModel.findById(ride._id);
        expect(persisted.captainCancellations).toHaveLength(1);
        expect(persisted.captainCancellations[0].reason).toBe('Passageiro não apareceu');
        expect(persisted.captainCancellations[0].atStatus).toBe('arrived');
        expect(persisted.captainCancellations[0].captain.toString()).toBe(captain._id.toString());
        // A corrida em si NÃO foi cancelada — só devolvida ao despacho, sem motorista.
        expect(persisted.cancelledBy).toBeFalsy();
        expect(persisted.cancelledAt).toBeFalsy();
    });

    it('cancelar em "accepted" (antes de chegar) continua funcionando sem motivo — não é obrigatório nesse estágio', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const captainToken = generateAuthToken(captain, 'captain');
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted' });

        const res = await request(app)
            .post('/rides/captain-cancel')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ rideId: ride._id.toString() });

        expect(res.statusCode).toBe(200);

        const persisted = await rideModel.findById(ride._id);
        // O histórico registra QUEM/QUANDO/EM QUE ESTÁGIO mesmo sem motivo — só o
        // motivo em si é opcional nesse estágio, não o registro do evento.
        expect(persisted.captainCancellations).toHaveLength(1);
        expect(persisted.captainCancellations[0].atStatus).toBe('accepted');
        expect(persisted.captainCancellations[0].reason).toBeFalsy();
    });

    it('motivo "Outro" com texto livre também é aceito e registrado', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const captainToken = generateAuthToken(captain, 'captain');
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'waiting_passenger', arrivedAt: new Date() });

        const res = await request(app)
            .post('/rides/captain-cancel')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ rideId: ride._id.toString(), reason: 'Passageiro pediu pra eu ir embora, mas não confirmou nada' });

        expect(res.statusCode).toBe(200);
        const persisted = await rideModel.findById(ride._id);
        expect(persisted.captainCancellations[0].reason).toBe('Passageiro pediu pra eu ir embora, mas não confirmou nada');
    });
});

describe('Cancelamento — campos de auditoria (cancelledBy/cancellationReason/cancelledAt)', () => {
    it('cancelamento do passageiro grava cancelledBy=passenger e cancelledAt', async () => {
        const user = await createUser();
        const userToken = generateAuthToken(user, 'user');
        const ride = await createRide({ user: user._id, captain: undefined, status: 'requested' });

        const before = Date.now();
        const res = await request(app)
            .post('/rides/cancel')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ rideId: ride._id.toString() });

        expect(res.statusCode).toBe(200);
        const persisted = await rideModel.findById(ride._id);
        expect(persisted.status).toBe('cancelled');
        expect(persisted.cancelledBy).toBe('passenger');
        expect(persisted.cancelledAt).toBeTruthy();
        expect(new Date(persisted.cancelledAt).getTime()).toBeGreaterThanOrEqual(before);
    });

    it('cancelamento do passageiro com motivo opcional grava cancellationReason', async () => {
        const user = await createUser();
        const userToken = generateAuthToken(user, 'user');
        const ride = await createRide({ user: user._id, captain: undefined, status: 'requested' });

        const res = await request(app)
            .post('/rides/cancel')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ rideId: ride._id.toString(), reason: 'Mudei de ideia' });

        expect(res.statusCode).toBe(200);
        const persisted = await rideModel.findById(ride._id);
        expect(persisted.cancellationReason).toBe('Mudei de ideia');
    });

    it('CANCELLED é terminal: não aceita novo cancelamento, nem aceite, nem início', async () => {
        const user = await createUser();
        const userToken = generateAuthToken(user, 'user');
        const captain = await createCaptain();
        const captainToken = generateAuthToken(captain, 'captain');
        const ride = await createRide({ user: user._id, captain: undefined, status: 'requested' });

        await request(app).post('/rides/cancel').set('Authorization', `Bearer ${userToken}`).send({ rideId: ride._id.toString() });

        const cancelAgain = await request(app)
            .post('/rides/cancel')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ rideId: ride._id.toString() });
        expect(cancelAgain.statusCode).toBe(409);

        const acceptAttempt = await request(app)
            .post(`/rides/${ride._id}/accept`)
            .set('Authorization', `Bearer ${captainToken}`);
        expect(acceptAttempt.statusCode).toBe(409);

        const persisted = await rideModel.findById(ride._id);
        expect(persisted.status).toBe('cancelled');
        expect(persisted.captain).toBeFalsy();
    });
});

describe('Cancelamento — tempo real chegando no passageiro quando o motorista cancela (correção do canal)', () => {
    let httpServer, port;

    beforeAll((done) => {
        httpServer = createServer();
        initializeSocket(httpServer);
        httpServer.listen(() => { port = httpServer.address().port; done(); });
    });

    afterAll((done) => { httpServer.close(done); });

    const connectClient = () => new Promise((resolve) => {
        const c = new Client(`http://localhost:${port}`);
        c.on('connect', () => resolve(c));
    });

    it('passageiro conectado recebe ride-cancelled-by-captain diretamente (não pela sala de candidatos)', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted' });
        const captainToken = generateAuthToken(captain, 'captain');

        const passengerSocket = await connectClient();
        const joinAck = await new Promise((resolve) => {
            passengerSocket.emit('join', { userId: user._id, userType: 'user', token: generateAuthToken(user, 'user') }, resolve);
        });
        expect(joinAck.ok).toBe(true);

        const eventPromise = new Promise((resolve) => {
            passengerSocket.on('ride-cancelled-by-captain', resolve);
        });

        const res = await request(app)
            .post('/rides/captain-cancel')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ rideId: ride._id.toString() });
        expect(res.statusCode).toBe(200);

        const eventData = await eventPromise;
        expect(eventData.rideId.toString()).toBe(ride._id.toString());

        passengerSocket.close();
    });
});

describe('Cancelamento — notificação push ao passageiro quando o motorista cancela', () => {
    it('gera uma Notification real pro passageiro (não pro motorista)', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const captainToken = generateAuthToken(captain, 'captain');
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'going_to_pickup' });
        await NotificationToken.create({ userId: user._id, token: 'tok-cancelamento-passageiro', device: 'test' });

        const res = await request(app)
            .post('/rides/captain-cancel')
            .set('Authorization', `Bearer ${captainToken}`)
            .send({ rideId: ride._id.toString() });
        expect(res.statusCode).toBe(200);

        const notification = await waitFor(() => Notification.findOne({ userId: user._id, type: 'RIDE_CANCELLED' }));
        expect(notification).toBeTruthy();

        // Não deve gerar notificação enganosa pro MOTORISTA que acabou de cancelar.
        const captainNotification = await Notification.findOne({ captainId: captain._id, type: 'RIDE_CANCELLED' });
        expect(captainNotification).toBeFalsy();
    });
});

describe('Cancelamento — auto-expiração usa transição atômica (corrige race condition)', () => {
    it('corrida "requested" há mais de 10min some do getCurrentRide e fica cancelledBy=system', async () => {
        const user = await createUser();
        const userToken = generateAuthToken(user, 'user');
        const ride = await createRide({ user: user._id, captain: undefined, status: 'requested' });
        // findByIdAndUpdate não é confiável pra retroceder createdAt (o hook de
        // timestamps do Mongoose intercepta updates) — direto no documento + save()
        // garante que o valor realmente persiste como o teste espera.
        ride.createdAt = new Date(Date.now() - 11 * 60 * 1000);
        await ride.save();

        const res = await request(app)
            .get('/rides/current')
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.statusCode).toBe(404);

        const persisted = await rideModel.findById(ride._id);
        expect(persisted.status).toBe('cancelled');
        expect(persisted.cancelledBy).toBe('system');
        expect(persisted.cancellationReason).toBeTruthy();
    });

    it('corrida já aceita por um motorista no instante da checagem NÃO é expirada (filtro atômico de status)', async () => {
        const user = await createUser();
        const userToken = generateAuthToken(user, 'user');
        const captain = await createCaptain();
        // status já não é mais 'requested' — o filtro de transitionRide não bate.
        const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted' });
        await rideModel.findByIdAndUpdate(ride._id, { createdAt: new Date(Date.now() - 11 * 60 * 1000) });

        const res = await request(app)
            .get('/rides/current')
            .set('Authorization', `Bearer ${userToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('accepted');

        const persisted = await rideModel.findById(ride._id);
        expect(persisted.status).toBe('accepted'); // não foi tocada
    });
});
