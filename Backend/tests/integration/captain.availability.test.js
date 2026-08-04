const request = require('supertest');
const app = require('../../app');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const captainModel = require('../../models/captain.model');
const vehicleCategoryModel = require('../../models/vehicleCategory.model');
const NotificationToken = require('../../models/notificationToken.model');
const Notification = require('../../models/notification.model');
const mapService = require('../../services/maps.service');
const captainService = require('../../services/captain.service');
const { deleteByPrefix } = require('../../cache/cache');

// Separação disponibilidade x conexão (2026-08-03) — ver
// docs/plans/2026-08-03-disponibilidade-vs-conexao-motorista.md.
//
// Antes destas mudanças, `getCaptainsInTheRadius` exigia socketId != null, e o
// disconnect do socket zerava isOnline. O resultado, comprovado na auditoria final do
// sistema de push: um motorista com o app FECHADO nunca era candidato ao despacho e,
// portanto, a push de corrida nova (todo o objetivo daquela correção) era inalcançável.
//
// Estes testes usam o mesmo getCaptainsInTheRadius e os mesmos endpoints de produção.
const PICKUP = { ltd: -23.5505, lng: -46.6333 };

const availableCaptain = (overrides = {}) => createCaptain({
    isOnline: true,
    lastSeenAt: new Date(),
    location: PICKUP,
    locationGeoJSON: { type: 'Point', coordinates: [PICKUP.lng, PICKUP.ltd] },
    ...overrides
});

describe('Disponibilidade do motorista x conexão de socket', () => {
    beforeEach(() => {
        // getCaptainsInTheRadius tem cache de 10s por coordenada; sem limpar, um teste
        // enxergaria o resultado do anterior.
        deleteByPrefix('drivers:');
    });

    it('motorista com o APP FECHADO (sem socket) continua sendo despachado — o cenário que antes era impossível', async () => {
        // Estado exato que o disconnect do socket grava hoje: socketId null, mas a
        // intenção de receber corridas (isOnline) preservada.
        await availableCaptain({ socketId: null, vehicle: { color: 'Preto', plate: 'FEC1234', capacity: 4, vehicleType: 'car' } });

        const encontrados = await mapService.getCaptainsInTheRadius(PICKUP.ltd, PICKUP.lng, 15);

        expect(encontrados.length).toBe(1);
        expect(encontrados[0].socketId).toBeFalsy();
    });

    it('motorista sem contato há mais tempo que o TTL sai do despacho', async () => {
        const forintervalo = captainService.AVAILABILITY_TTL_MINUTES + 5;
        await availableCaptain({
            socketId: null,
            lastSeenAt: new Date(Date.now() - forintervalo * 60 * 1000),
            vehicle: { color: 'Preto', plate: 'VEL1234', capacity: 4, vehicleType: 'car' }
        });

        const encontrados = await mapService.getCaptainsInTheRadius(PICKUP.ltd, PICKUP.lng, 15);
        expect(encontrados.length).toBe(0);
    });

    it('motorista que escolheu ficar offline não é despachado, mesmo com socket vivo', async () => {
        await availableCaptain({
            isOnline: false,
            socketId: 'socket-vivo',
            vehicle: { color: 'Preto', plate: 'OFF1234', capacity: 4, vehicleType: 'car' }
        });

        const encontrados = await mapService.getCaptainsInTheRadius(PICKUP.ltd, PICKUP.lng, 15);
        expect(encontrados.length).toBe(0);
    });

    it('motorista bloqueado pelo admin não é despachado, mesmo disponível e recém-visto', async () => {
        await availableCaptain({
            isBlocked: true,
            vehicle: { color: 'Preto', plate: 'BLQ1234', capacity: 4, vehicleType: 'car' }
        });

        const encontrados = await mapService.getCaptainsInTheRadius(PICKUP.ltd, PICKUP.lng, 15);
        expect(encontrados.length).toBe(0);
    });

    it('toggle-online grava lastSeenAt, sustentando a disponibilidade depois que o app fechar', async () => {
        const captain = await createCaptain({ isOnline: false, lastSeenAt: null });
        const token = generateAuthToken(captain, 'captain');

        const res = await request(app)
            .post('/captains/toggle-online')
            .set('Authorization', `Bearer ${token}`)
            .send({ isOnline: true });

        expect(res.statusCode).toBe(200);

        const persisted = await captainModel.findById(captain._id);
        expect(persisted.isOnline).toBe(true);
        expect(persisted.lastSeenAt).toBeTruthy();
    });

    // O ponto central: o fluxo real ponta a ponta que a auditoria final apontou como
    // quebrado. Passageiro cria corrida, o único motorista compatível está com o app
    // fechado — e mesmo assim recebe a notificação.
    it('CENÁRIO 2: passageiro cria corrida e o motorista com o app fechado recebe a notificação push', async () => {
        await vehicleCategoryModel.create({
            name: 'car', displayName: 'Carro', baseFare: 5, perKmRate: 1.5,
            perMinuteRate: 0.3, minFare: 8, isActive: true
        });

        const captain = await availableCaptain({
            socketId: null, // app fechado
            vehicle: { color: 'Prata', plate: 'PSH9999', capacity: 4, vehicleType: 'car' }
        });
        await NotificationToken.create({ captainId: captain._id, token: 'tok-app-fechado', device: 'test' });

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

        const waitFor = async (attempts = 30, delayMs = 100) => {
            for (let i = 0; i < attempts; i++) {
                const found = await Notification.findOne({ captainId: captain._id, type: 'NEW_RIDE' });
                if (found && found.status !== 'sending') return found;
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            return null;
        };

        const notification = await waitFor();
        expect(notification).toBeTruthy();
        // Diagnóstico de push de corrida (2026-08-03): título/formato atualizados.
        expect(notification.title).toMatch(/Nova corrida/);
    });
});

describe('Contabilidade de tempo online x disponibilidade', () => {
    it('endOnlineSession fecha a sessão de tempo sem mexer na disponibilidade', async () => {
        // Reproduz o que o disconnect do socket faz hoje: fecha a contagem de tempo,
        // mas NÃO derruba a intenção do motorista de continuar recebendo corridas.
        const captain = await createCaptain({
            isOnline: true,
            onlineSince: new Date(Date.now() - 60 * 1000),
            lastSeenAt: new Date()
        });

        await captainService.endOnlineSession(captain._id);

        const persisted = await captainModel.findById(captain._id);
        expect(persisted.onlineSince).toBeFalsy();          // sessão de tempo fechada
        expect(persisted.onlineTimeSeconds).toBeGreaterThan(0); // tempo contabilizado
        expect(persisted.isOnline).toBe(true);              // disponibilidade preservada
    });

    it('tempo online não conta enquanto o motorista está disponível porém desconectado', async () => {
        const captain = await createCaptain({
            isOnline: true,
            onlineSince: null, // desconectado: nenhuma sessão aberta
            todayOnlineSeconds: 120,
            todayOnlineDate: new Date(new Date().setHours(0, 0, 0, 0)),
            lastSeenAt: new Date()
        });

        const seconds = await captainService.getTodayOnlineSeconds(captain._id);
        // Só o acumulado já fechado — nada de tempo "em andamento" sem conexão.
        expect(seconds).toBe(120);
    });
});
