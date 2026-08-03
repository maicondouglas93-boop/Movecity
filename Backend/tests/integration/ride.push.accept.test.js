const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const vehicleCategoryModel = require('../../models/vehicleCategory.model');
const NotificationToken = require('../../models/notificationToken.model');
const Notification = require('../../models/notification.model');
const rideModel = require('../../models/ride.model');

// Diagnóstico e correção do push de corrida (2026-08-03). Cobre exatamente os 5
// cenários pedidos, contra banco real (MongoMemoryReplSet) e os endpoints reais que o
// Service Worker chama — não simula o resultado, exercita o caminho de verdade.
//
// O único ponto que um teste de backend não alcança é a ENTREGA no dispositivo e o
// clique físico na notificação — isso é inerente a qualquer teste automatizado de push
// (não há navegador real aqui). O que É verificado é tudo que acontece nas duas pontas
// desse clique: o payload que o backend monta e manda pro Firebase, e o endpoint que o
// clique em "Aceitar" de fato chama.
const PICKUP = { ltd: -23.5505, lng: -46.6333 };

const seedCarCategory = () => vehicleCategoryModel.create({
    name: 'car', displayName: 'Carro', baseFare: 5, perKmRate: 1.5,
    perMinuteRate: 0.3, minFare: 8, isActive: true
});

const waitFor = async (queryFn, attempts = 30, delayMs = 100) => {
    for (let i = 0; i < attempts; i++) {
        const found = await queryFn();
        if (found && found.status !== 'sending') return found;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
};

describe('Push de corrida — cenário 1: motorista com o app fechado recebe a oferta', () => {
    beforeEach(seedCarCategory);

    it('a notificação chega com preço formatado no texto, exatamente como o SW vai exibir', async () => {
        const captain = await createCaptain({
            isOnline: true,
            socketId: null, // app fechado — nada de socket vivo
            lastSeenAt: new Date(),
            location: PICKUP,
            locationGeoJSON: { type: 'Point', coordinates: [PICKUP.lng, PICKUP.ltd] },
            vehicle: { color: 'Prata', plate: 'CEN1111', capacity: 4, vehicleType: 'car' }
        });
        await NotificationToken.create({ captainId: captain._id, token: 'tok-cenario1', device: 'test' });

        const user = await createUser();
        const userToken = generateAuthToken(user, 'user');

        const rideRes = await request(app)
            .post('/rides/create')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
                pickup: 'Avenida Paulista, 1000',
                destination: 'Avenida Faria Lima, 2000',
                vehicleType: 'car',
                paymentMethod: 'pix'
            });
        expect(rideRes.statusCode).toBe(201);

        const notification = await waitFor(() => Notification.findOne({ captainId: captain._id, type: 'NEW_RIDE' }));
        expect(notification).toBeTruthy();
        expect(notification.title).toBe('🚗 Nova corrida disponível');
        // Achado 1 do diagnóstico: antes a mensagem era genérica, sem valor nenhum.
        expect(notification.message).toMatch(/^Passageiro próximo • R\$ \d+,\d{2}$/);
    });
});

describe('Push de corrida — cenário 2: motorista toca em "Aceitar" na notificação', () => {
    it('o endpoint que o Service Worker chama aceita de verdade e avisa o passageiro', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: undefined, status: 'requested' });
        const captainToken = generateAuthToken(captain, 'captain');
        await NotificationToken.create({ userId: user._id, token: 'tok-cenario2-user', device: 'test' });

        // Exatamente a chamada que firebase-messaging-sw.js faz no notificationclick,
        // ação 'accept': POST {apiUrl}/rides/{rideId}/accept com Bearer do IndexedDB.
        const res = await request(app)
            .post(`/rides/${ride._id}/accept`)
            .set('Authorization', `Bearer ${captainToken}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('accepted');
        expect(res.body.captain).toBeTruthy();
        expect(res.body.otp).toBeUndefined(); // nunca vaza o PIN pro motorista

        const persisted = await rideModel.findById(ride._id);
        expect(persisted.status).toBe('accepted');
        expect(persisted.captain.toString()).toBe(captain._id.toString());

        // "Atualizar status em tempo real" (item 3) — o passageiro é notificado.
        const notification = await waitFor(() => Notification.findOne({ userId: user._id, type: 'RIDE_ACCEPTED' }));
        expect(notification).toBeTruthy();
    });
});

describe('Push de corrida — cenário 3: dois motoristas tocam em "Aceitar" ao mesmo tempo', () => {
    it('exatamente um vence; o outro recebe 409 e a corrida tem só um motorista', async () => {
        const user = await createUser();
        const captainA = await createCaptain();
        const captainB = await createCaptain();
        const ride = await createRide({ user: user._id, captain: undefined, status: 'requested' });
        const tokenA = generateAuthToken(captainA, 'captain');
        const tokenB = generateAuthToken(captainB, 'captain');

        // Simula os dois tocando em "Aceitar" no mesmo instante — o caminho real que
        // acceptRideAtomic (findOneAndUpdate atômico, filtro status:'requested') existe
        // pra resolver.
        const [resA, resB] = await Promise.all([
            request(app).post(`/rides/${ride._id}/accept`).set('Authorization', `Bearer ${tokenA}`),
            request(app).post(`/rides/${ride._id}/accept`).set('Authorization', `Bearer ${tokenB}`)
        ]);

        const statuses = [resA.statusCode, resB.statusCode].sort();
        expect(statuses).toEqual([200, 409]);

        const loser = resA.statusCode === 409 ? resA : resB;
        expect(loser.body.message).toBe('Corrida já aceita por outro motorista');

        const persisted = await rideModel.findById(ride._id);
        expect(persisted.status).toBe('accepted');
        // Só um dos dois motoristas ficou com a corrida — nunca os dois.
        const winnerCaptainId = resA.statusCode === 200 ? captainA._id : captainB._id;
        expect(persisted.captain.toString()).toBe(winnerCaptainId.toString());
    });
});

describe('Push de corrida — cenário 4: token expirado ao tocar em "Aceitar"', () => {
    it('o backend rejeita com 401 — é o sinal que o Service Worker usa pra mostrar "Sessão expirada"', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: undefined, status: 'requested' });

        // JWT real, verificado de verdade pelo jsonwebtoken, já expirado — não um mock
        // de relógio. É o mesmo padrão já usado na auditoria de sessão persistente.
        const expiredToken = jwt.sign({ _id: captain._id }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '-1h' });

        const res = await request(app)
            .post(`/rides/${ride._id}/accept`)
            .set('Authorization', `Bearer ${expiredToken}`);

        expect(res.statusCode).toBe(401);

        // A corrida continua disponível — a tentativa falha por autenticação, não some
        // do pool de despacho.
        const persisted = await rideModel.findById(ride._id);
        expect(persisted.status).toBe('requested');
    });
});

describe('Push de corrida — cenário 5: corrida cancelada antes do clique em "Aceitar"', () => {
    it('o motorista recebe a mensagem correta ("passageiro cancelou"), não "outro motorista aceitou"', async () => {
        const user = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: user._id, captain: undefined, status: 'requested' });
        const userToken = generateAuthToken(user, 'user');
        const captainToken = generateAuthToken(captain, 'captain');

        // Passageiro cancela ANTES do motorista clicar — a notificação já estava na
        // bandeja dele quando isso aconteceu (cenário real: motorista com o app fechado
        // demora alguns segundos pra reagir à notificação).
        const cancelRes = await request(app)
            .post('/rides/cancel')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ rideId: ride._id.toString() });
        expect(cancelRes.statusCode).toBe(200);

        const acceptRes = await request(app)
            .post(`/rides/${ride._id}/accept`)
            .set('Authorization', `Bearer ${captainToken}`);

        expect(acceptRes.statusCode).toBe(409);
        // Achado 4 do diagnóstico: antes essa mensagem era "Corrida já aceita por outro
        // motorista" — errada, ninguém aceitou, o passageiro cancelou.
        expect(acceptRes.body.message).toBe('O passageiro cancelou esta corrida.');
        expect(acceptRes.body.message).not.toMatch(/outro motorista/i);
    });
});
