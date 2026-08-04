const request = require('supertest');
const app = require('../../app');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');

// Fase A da experiência de corrida ativa (2026-08-03).
//
// Estes endpoints são a fonte de restauração do frontend (RideContext): a cada
// abertura/refresh/reconexão/retorno do background, o app consulta /rides/current
// (passageiro) e /rides/captain-current (motorista) e reconstrói a interface inteira.
// Os testes garantem o contrato do qual a restauração depende.
describe('Restauração da corrida ativa (Fase A)', () => {
    let user;
    let captain;
    let userToken;
    let captainToken;

    beforeEach(async () => {
        user = await createUser();
        captain = await createCaptain();
        userToken = generateAuthToken(user);
        captainToken = generateAuthToken(captain, 'captain');
    });

    describe('GET /rides/current (passageiro)', () => {
        it('retorna a corrida ativa COM o PIN (otp) — sem ele a tela de espera restaurada perdia o PIN', async () => {
            await createRide({ user: user._id, captain: captain._id, status: 'accepted', otp: '654321' });

            const res = await request(app)
                .get('/rides/current')
                .set('Authorization', `Bearer ${userToken}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('accepted');
            // Regressão: otp tem select:false no model; /rides/current precisa
            // selecioná-lo explicitamente pro PIN sobreviver ao refresh.
            expect(res.body.otp).toBe('654321');
            expect(res.body.captain).toBeTruthy();
        });

        it('retorna corrida em waiting_passenger (estado restaurável)', async () => {
            await createRide({ user: user._id, captain: captain._id, status: 'waiting_passenger' });

            const res = await request(app)
                .get('/rides/current')
                .set('Authorization', `Bearer ${userToken}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('waiting_passenger');
        });

        it('retorna corrida started — o frontend usa isso pra redirecionar pra /riding', async () => {
            await createRide({ user: user._id, captain: captain._id, status: 'started' });

            const res = await request(app)
                .get('/rides/current')
                .set('Authorization', `Bearer ${userToken}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('started');
        });

        it('retorna 404 quando não há corrida ativa (estado idle limpo)', async () => {
            await createRide({ user: user._id, captain: captain._id, status: 'finished' });

            const res = await request(app)
                .get('/rides/current')
                .set('Authorization', `Bearer ${userToken}`);

            expect(res.statusCode).toBe(404);
        });
    });

    describe('GET /rides/captain-current (motorista)', () => {
        it('retorna a corrida ativa do motorista SEM expor o PIN', async () => {
            await createRide({ user: user._id, captain: captain._id, status: 'going_to_pickup', otp: '654321' });

            const res = await request(app)
                .get('/rides/captain-current')
                .set('Authorization', `Bearer ${captainToken}`);

            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('going_to_pickup');
            // O PIN é do passageiro — o motorista só pode conhecê-lo quando o
            // passageiro fala em voz alta. Não pode vazar na restauração.
            expect(res.body.otp).toBeUndefined();
            expect(res.body.user).toBeTruthy();
        });

        it('retorna 404 quando o motorista não tem corrida ativa', async () => {
            const res = await request(app)
                .get('/rides/captain-current')
                .set('Authorization', `Bearer ${captainToken}`);

            expect(res.statusCode).toBe(404);
        });
    });

    describe('POST /rides/update-status → waiting_passenger (regressão)', () => {
        it('aceita a transição arrived → waiting_passenger (antes lançava "Transição de status desconhecida")', async () => {
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'arrived' });

            const res = await request(app)
                .post('/rides/update-status')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId: ride._id, status: 'waiting_passenger' });

            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('waiting_passenger');
        });

        it('recusa waiting_passenger a partir de um estado inválido (ex.: accepted)', async () => {
            const ride = await createRide({ user: user._id, captain: captain._id, status: 'accepted' });

            const res = await request(app)
                .post('/rides/update-status')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId: ride._id, status: 'waiting_passenger' });

            expect(res.statusCode).toBe(409);
        });
    });

    describe('Fluxo completo com restauração em cada etapa', () => {
        it('accepted → going_to_pickup → arrived → waiting_passenger → started, com os dois endpoints refletindo cada estado', async () => {
            const ride = await createRide({ user: user._id, status: 'requested', otp: '111222' });

            // Aceite (atômico)
            const acceptRes = await request(app)
                .post('/rides/confirm')
                .set('Authorization', `Bearer ${captainToken}`)
                .send({ rideId: ride._id });
            expect(acceptRes.statusCode).toBe(200);

            // Simula "refresh" dos dois lados após o aceite
            let userView = await request(app).get('/rides/current').set('Authorization', `Bearer ${userToken}`);
            let captainView = await request(app).get('/rides/captain-current').set('Authorization', `Bearer ${captainToken}`);
            expect(userView.body.status).toBe('accepted');
            expect(userView.body.otp).toBe('111222');
            expect(captainView.body.status).toBe('accepted');

            // Caminho até o embarque
            for (const status of ['going_to_pickup', 'arrived', 'waiting_passenger']) {
                const stepRes = await request(app)
                    .post('/rides/update-status')
                    .set('Authorization', `Bearer ${captainToken}`)
                    .send({ rideId: ride._id, status });
                expect(stepRes.statusCode).toBe(200);

                captainView = await request(app).get('/rides/captain-current').set('Authorization', `Bearer ${captainToken}`);
                expect(captainView.body.status).toBe(status);
            }

            // Início com o PIN
            const startRes = await request(app)
                .get('/rides/start-ride')
                .set('Authorization', `Bearer ${captainToken}`)
                .query({ rideId: ride._id.toString(), otp: '111222' });
            expect(startRes.statusCode).toBe(200);

            userView = await request(app).get('/rides/current').set('Authorization', `Bearer ${userToken}`);
            captainView = await request(app).get('/rides/captain-current').set('Authorization', `Bearer ${captainToken}`);
            expect(userView.body.status).toBe('started');
            expect(captainView.body.status).toBe('started');
        });
    });
});
