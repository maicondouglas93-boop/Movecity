const request = require('supertest');
const app = require('../../app');
const rideModel = require('../../models/ride.model');
const { generateAuthToken } = require('../setup/authHelper');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');
const { createRide } = require('../factories/ride.factory');

// Fase B da experiência de corrida ativa (2026-08-03): GET /rides/pending é o caminho
// de recuperação para ofertas perdidas — se o 'new-ride' via socket/push não chegou
// (app fechado, push falhou, reconexão), o pull traz a corrida de volta. Os critérios
// devem espelhar os do despacho: requested + janela de 10 min + mesmo vehicleType +
// raio de 15 km da posição do motorista.

const CAPTAIN_POS = { ltd: -23.5505, lng: -46.6333 }; // Av. Paulista
const NEAR_PICKUP = { lat: -23.5610, lng: -46.6560 }; // ~2,5 km
const FAR_PICKUP = { lat: -24.5000, lng: -46.6333 };  // ~105 km

const availableCaptain = (overrides = {}) => createCaptain({
    isOnline: true,
    location: CAPTAIN_POS,
    ...overrides
});

const pendingRide = async (overrides = {}) => createRide({
    user: (await createUser())._id,
    status: 'requested',
    vehicleType: 'car',
    pickupCoordinates: NEAR_PICKUP,
    ...overrides
});

describe('GET /rides/pending (Fase B)', () => {
    it('retorna corrida requested compatível (mesmo veículo, dentro do raio e da janela)', async () => {
        const captain = await availableCaptain();
        const ride = await pendingRide();

        const res = await request(app)
            .get('/rides/pending')
            .set('Authorization', `Bearer ${generateAuthToken(captain, 'captain')}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(1);
        expect(res.body[0]._id).toBe(ride._id.toString());
        expect(res.body[0].status).toBe('requested');
        // Populado como no evento 'new-ride' — o card/popup precisa do nome do passageiro.
        expect(res.body[0].user?.fullname?.firstname).toBeTruthy();
    });

    it('não retorna corrida de outro tipo de veículo', async () => {
        const captain = await availableCaptain(); // vehicle car (factory)
        await pendingRide({ vehicleType: 'moto' });

        const res = await request(app)
            .get('/rides/pending')
            .set('Authorization', `Bearer ${generateAuthToken(captain, 'captain')}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(0);
    });

    it('não retorna corrida fora do raio de 15 km', async () => {
        const captain = await availableCaptain();
        await pendingRide({ pickupCoordinates: FAR_PICKUP });

        const res = await request(app)
            .get('/rides/pending')
            .set('Authorization', `Bearer ${generateAuthToken(captain, 'captain')}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(0);
    });

    it('não retorna corrida mais velha que a janela de expiração (10 min)', async () => {
        const captain = await availableCaptain();
        const stale = await pendingRide();
        // Direto na collection pra contornar os timestamps automáticos do mongoose.
        await rideModel.collection.updateOne(
            { _id: stale._id },
            { $set: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } }
        );

        const res = await request(app)
            .get('/rides/pending')
            .set('Authorization', `Bearer ${generateAuthToken(captain, 'captain')}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(0);
    });

    it('não retorna corrida já aceita por alguém', async () => {
        const captain = await availableCaptain();
        await pendingRide({ status: 'accepted' });

        const res = await request(app)
            .get('/rides/pending')
            .set('Authorization', `Bearer ${generateAuthToken(captain, 'captain')}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(0);
    });

    it('motorista que escolheu ficar offline não vê pendentes (mesmo critério do despacho)', async () => {
        const captain = await availableCaptain({ isOnline: false });
        await pendingRide();

        const res = await request(app)
            .get('/rides/pending')
            .set('Authorization', `Bearer ${generateAuthToken(captain, 'captain')}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(0);
    });

    it('motorista sem posição conhecida recebe lista vazia (raio incalculável)', async () => {
        const captain = await availableCaptain({ location: undefined });
        await pendingRide();

        const res = await request(app)
            .get('/rides/pending')
            .set('Authorization', `Bearer ${generateAuthToken(captain, 'captain')}`);

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(0);
    });

    it('exige autenticação de motorista', async () => {
        const res = await request(app).get('/rides/pending');
        expect(res.statusCode).toBe(401);
    });
});
