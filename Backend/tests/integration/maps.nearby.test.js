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

    it('retorna motorista disponível com autorização para definir o ícone, sem dados pessoais', async () => {
        const captain = await availableCaptain({ vehicleAuthorization: 'car_motorcycle' });

        const res = await request(app)
            .get('/maps/nearby-drivers')
            .set('Authorization', `Bearer ${userToken}`)
            .query({ lat: VIEWER_POS.lat, lng: VIEWER_POS.lng });

        expect(res.statusCode).toBe(200);
        expect(res.body.length).toBe(1);
        const driver = res.body[0];
        // O id do mapa público é um pseudônimo HMAC por assinatura (utils/publicDriverMap.js),
        // não o _id real — devolver o ObjectId deixaria o passageiro correlacionar cada
        // ponto do mapa com um motorista de verdade. Cravar o id real aqui cobrava
        // exatamente o vazamento que o produto decidiu fechar.
        expect(driver.id).toMatch(/^drv_[0-9a-f]{24}$/);
        expect(driver.id).not.toBe(captain._id.toString());
        expect(driver.vehicleType).toBe('car');
        expect(driver.vehicleAuthorization).toBe('car_motorcycle');
        // A posição do mapa público é arredondada de propósito (PUBLIC_LOCATION_DECIMALS)
        // — precisão de rua, não de porta. Cravar igualdade exata cobrava a precisão total
        // que o produto decidiu não expor.
        expect(driver.location.ltd).toBeCloseTo(VIEWER_POS.lat, 3);
        // Posição de frota é sensível — nome/telefone/placa não podem vazar pra quem
        // só está olhando o mapa.
        expect(Object.keys(driver).sort()).toEqual(['id', 'location', 'vehicleAuthorization', 'vehicleType']);
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
