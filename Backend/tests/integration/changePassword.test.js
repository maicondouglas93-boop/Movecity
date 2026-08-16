const request = require('supertest');
const app = require('../../app');
const { createUser } = require('../factories/user.factory');
const userModel = require('../../models/user.model');
const refreshTokenModel = require('../../models/refreshToken.model');

// Plano de correção (Fase 1.2, 2026-08-16): ChangePassword.jsx chamava PUT
// /users/password, endpoint inexistente até esta correção — 404 garantido.
describe('PUT /users/password', () => {
    const EMAIL = `changepw_${Date.now()}@test.com`;
    const CURRENT_PASSWORD = 'senhaAtual123!';
    const NEW_PASSWORD = 'novaSenha456!';

    let user;

    beforeEach(async () => {
        await userModel.deleteMany({ email: EMAIL });
        user = await createUser({
            email: EMAIL,
            password: await userModel.hashPassword(CURRENT_PASSWORD),
        });
    });

    const login = async (password = CURRENT_PASSWORD) => request(app)
        .post('/users/login')
        .send({ email: EMAIL, password });

    it('troca a senha com sucesso quando a senha atual está correta', async () => {
        const loginRes = await login();
        expect(loginRes.status).toBe(200);

        const res = await request(app)
            .put('/users/password')
            .set('Authorization', `Bearer ${loginRes.body.token}`)
            .send({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();

        // Login com a senha antiga falha; com a nova, funciona.
        const oldLogin = await login(CURRENT_PASSWORD);
        expect(oldLogin.status).toBe(401);
        const newLogin = await login(NEW_PASSWORD);
        expect(newLogin.status).toBe(200);
    });

    it('rejeita com senha atual incorreta e não altera a senha', async () => {
        const loginRes = await login();

        const res = await request(app)
            .put('/users/password')
            .set('Authorization', `Bearer ${loginRes.body.token}`)
            .send({ currentPassword: 'senhaErrada123!', newPassword: NEW_PASSWORD });

        expect(res.status).toBe(401);

        const stillWorks = await login(CURRENT_PASSWORD);
        expect(stillWorks.status).toBe(200);
    });

    it('rejeita nova senha fraca (sem símbolo)', async () => {
        const loginRes = await login();

        const res = await request(app)
            .put('/users/password')
            .set('Authorization', `Bearer ${loginRes.body.token}`)
            .send({ currentPassword: CURRENT_PASSWORD, newPassword: 'semSimbolo123' });

        expect(res.status).toBe(400);
    });

    it('rejeita sem autenticação', async () => {
        const res = await request(app)
            .put('/users/password')
            .send({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD });

        expect(res.status).toBe(401);
    });

    it('revoga as outras sessões mas emite um par novo pra este dispositivo', async () => {
        const sessionA = await login();
        const sessionB = await login();
        expect(sessionA.body.refreshToken).not.toBe(sessionB.body.refreshToken);

        const changeRes = await request(app)
            .put('/users/password')
            .set('Authorization', `Bearer ${sessionA.body.token}`)
            .send({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD });
        expect(changeRes.status).toBe(200);

        // Sessão B (outro dispositivo) não renova mais.
        const refreshB = await request(app)
            .post('/users/refresh')
            .send({ refreshToken: sessionB.body.refreshToken });
        expect(refreshB.status).toBe(401);

        // O par novo devolvido pra sessão A (o dispositivo que trocou a senha) continua
        // funcionando normalmente.
        const refreshA = await request(app)
            .post('/users/refresh')
            .send({ refreshToken: changeRes.body.refreshToken });
        expect(refreshA.status).toBe(200);

        const active = await refreshTokenModel.countDocuments({ userId: user._id, revokedAt: null });
        expect(active).toBeGreaterThan(0);
    });
});
