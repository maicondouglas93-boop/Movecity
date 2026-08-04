const request = require('supertest');
const app = require('../../app');
const captainModel = require('../../models/captain.model');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const { deleteByPrefix } = require('../../cache/cache');

// Fase C da experiência de corrida ativa (2026-08-03): snapshot dos motoristas
// disponíveis pro mapa do passageiro. Reconstrói o estado completo na abertura/
// reconexão/volta do background; o tempo real fica com os eventos de socket.

const VIEWER_POS = { lat: -23.5505, lng: -46.6333 };

const availableCaptain = (overrides = {}) => createCaptain({
    isOnline: true,
    lastSeenAt: new Date(),
    location: { ltd: VIEWER_POS.lat, lng: VIEWER_POS.lng },
    locationGeoJSON: { type: 'Point', coordinates: [VIEWER_POS.lng, VIEWER_POS.lat] },
    ...overrides
});

describe('GET /maps/nearby-drivers (Fase C)', () => {
    let user;
    let userToken;

    beforeAll(async () => {
        // O setup global dos testes não sincroniza índices; sem o 2dsphere de
        // locationGeoJSON, a query $nearSphere de getCaptainsInTheRadius falha.
        await captainModel.syncIndexes();
    });

    beforeEach(async () => {
        // getCaptainsInTheRadius tem cache de 10s por coordenada — sem limpar, um
        // teste enxergaria o resultado do anterior.
        deleteByPrefix('drivers:');
        user = await createUser();
        userToken = generateAuthToken(user);
    });

    it('retorna motorista disponível APENAS com id, vehicleType e location (nada pessoal)', async () => {
        const captain = await availableCaptain();

        const res = await request(app)
            .get('/maps/nearby-drivers')
            .set('Authorization', `Bearer ${userToken}`)
            .query({ lat: VIEWER_POS.lat, lng: VIEWER_POS.lng });

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(1);
        const driver = res.body[0];
        expect(driver.id).toBe(captain._id.toString());
        expect(driver.vehicleType).toBe('car');
        expect(driver.location.ltd).toBe(VIEWER_POS.lat);
        // Posição de frota é sensível — nome/telefone/placa não podem vazar pra quem
        // só está olhando o mapa.
        expect(Object.keys(driver).sort()).toEqual(['id', 'location', 'vehicleType']);
    });

    it('não retorna motorista com corrida ativa (ocupado não aparece como livre)', async () => {
        const captain = await availableCaptain();
        await createRide({ user: user._id, captain: captain._id, status: 'started' });

        const res = await request(app)
            .get('/maps/nearby-drivers')
            .set('Authorization', `Bearer ${userToken}`)
            .query({ lat: VIEWER_POS.lat, lng: VIEWER_POS.lng });

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(0);
    });

    it('não retorna motorista offline', async () => {
        await availableCaptain({ isOnline: false });

        const res = await request(app)
            .get('/maps/nearby-drivers')
            .set('Authorization', `Bearer ${userToken}`)
            .query({ lat: VIEWER_POS.lat, lng: VIEWER_POS.lng });

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(0);
    });

    it('exige autenticação de passageiro', async () => {
        const res = await request(app)
            .get('/maps/nearby-drivers')
            .query({ lat: VIEWER_POS.lat, lng: VIEWER_POS.lng });

        expect(res.statusCode).toBe(401);
    });

    it('valida lat/lng', async () => {
        const res = await request(app)
            .get('/maps/nearby-drivers')
            .set('Authorization', `Bearer ${userToken}`)
            .query({ lat: 'abc' });

        expect(res.statusCode).toBe(400);
    });
});
