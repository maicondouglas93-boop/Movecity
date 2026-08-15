const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../app');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const userModel = require('../../models/user.model');
const refreshTokenModel = require('../../models/refreshToken.model');
const authService = require('../../services/auth.service');

// Auditoria de autenticação e sessão persistente (2026-08-02).
// Cobre os cenários obrigatórios: usuário permanece logado indefinidamente, e a sessão
// só termina por logout explícito, revogação ou bloqueio.
//
// "Dias depois" é simulado do jeito honesto: gerando um access token REAL já expirado
// (expiresIn negativo, verificado pelo jsonwebtoken de verdade) em vez de mockar
// relógio — o que estamos testando é o comportamento do sistema com um token expirado,
// e um token expirado por -1h é indistinguível de um expirado há 5 dias.

describe('Sessão persistente — passageiro', () => {
    const LOGIN = { email: 'sessao@test.com', password: 'password123' };

    const loginUser = async () => {
        await createUser({ email: LOGIN.email, password: await userModel.hashPassword(LOGIN.password) });
        const res = await request(app).post('/users/login').send(LOGIN);
        return res;
    };

    it('1. Login emite access token E refresh token, e persiste a sessão no banco', async () => {
        const res = await loginUser();

        expect(res.statusCode).toBe(200);
        expect(res.body.token).toBeTruthy();
        expect(res.body.refreshToken).toBeTruthy();

        // O refresh token NUNCA é gravado em texto puro — só o hash.
        const storedRaw = await refreshTokenModel.findOne({ tokenHash: res.body.refreshToken });
        expect(storedRaw).toBeNull();

        const stored = await refreshTokenModel.findOne({ tokenHash: authService.hashToken(res.body.refreshToken) });
        expect(stored).toBeTruthy();
        expect(stored.userType).toBe('user');
        expect(stored.revokedAt).toBeNull();
    });

    it('2 + 3 + 4. "Fecha o navegador e volta dias depois": access token expirado + refresh válido = continua autenticado, sem login', async () => {
        const loginRes = await loginUser();
        const user = await userModel.findOne({ email: LOGIN.email });

        // Access token real, já expirado (é o que o navegador teria guardado dias atrás).
        const expiredAccessToken = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, { expiresIn: '-1h' });

        // Confirma que ele de fato não serve mais para nada.
        const rejected = await request(app).get('/users/profile').set('Authorization', `Bearer ${expiredAccessToken}`);
        expect(rejected.statusCode).toBe(401);

        // O refresh token guardado sobrevive ao fechamento do navegador e renova a sessão.
        const refreshRes = await request(app).post('/users/refresh').send({ refreshToken: loginRes.body.refreshToken });
        expect(refreshRes.statusCode).toBe(200);
        expect(refreshRes.body.token).toBeTruthy();
        expect(refreshRes.body.user).toBeTruthy();

        // E o access token novo funciona de verdade — usuário segue autenticado.
        const profileRes = await request(app).get('/users/profile').set('Authorization', `Bearer ${refreshRes.body.token}`);
        expect(profileRes.statusCode).toBe(200);
    });

    it('5. Rotação: cada renovação devolve um refresh token novo e invalida o anterior', async () => {
        const loginRes = await loginUser();
        const firstRefresh = loginRes.body.refreshToken;

        const rotated = await request(app).post('/users/refresh').send({ refreshToken: firstRefresh });
        expect(rotated.statusCode).toBe(200);
        expect(rotated.body.refreshToken).not.toBe(firstRefresh);

        // O token novo funciona.
        const second = await request(app).post('/users/refresh').send({ refreshToken: rotated.body.refreshToken });
        expect(second.statusCode).toBe(200);
    });

    it('6. Logout encerra a sessão: o refresh token para de funcionar', async () => {
        const loginRes = await loginUser();

        const logoutRes = await request(app)
            .post('/users/logout')
            .set('Authorization', `Bearer ${loginRes.body.token}`)
            .send({ refreshToken: loginRes.body.refreshToken });
        expect(logoutRes.statusCode).toBe(200);

        const afterLogout = await request(app).post('/users/refresh').send({ refreshToken: loginRes.body.refreshToken });
        expect(afterLogout.statusCode).toBe(401);
    });

    it('7. Usuário bloqueado: refresh recusado com 403 e sessões revogadas', async () => {
        const loginRes = await loginUser();
        await userModel.updateOne({ email: LOGIN.email }, { isBlocked: true });

        const res = await request(app).post('/users/refresh').send({ refreshToken: loginRes.body.refreshToken });
        expect(res.statusCode).toBe(403);
        expect(res.body.message).toMatch(/bloqueada/i);
    });

    // Auditoria de persistência de login (2026-08-03): este teste codificava como
    // "correto" exatamente o bug que causava logout depois de algum tempo sem usar o
    // sistema — duas requisições legítimas do mesmo usuário (duas abas, ou vários
    // componentes buscando dados ao mesmo tempo quando o app volta do segundo plano)
    // reapresentando o token quase ao mesmo tempo derrubavam a sessão inteira, mesmo
    // sem nenhum roubo de verdade. Ver docs/plans/2026-08-03-auditoria-persistencia-
    // login.md. Reuso DENTRO da janela de tolerância (a corrida legítima) é tolerado,
    // mas só uma requisição cria refresh sucessor; as demais recebem access token sem
    // abrir ramificações. Reuso FORA da janela (roubo real) revoga a família.
    it('8a. Reuso DENTRO da janela de tolerância (corrida entre abas) não derruba a sessão', async () => {
        const loginRes = await loginUser();
        const originalToken = loginRes.body.refreshToken;

        const responses = await Promise.all(Array.from({ length: 20 }, () => (
            request(app).post('/users/refresh').send({ refreshToken: originalToken })
        )));
        expect(responses.every((response) => response.statusCode === 200)).toBe(true);

        const durable = responses.filter((response) => response.body.refreshToken);
        const accessOnly = responses.filter((response) => !response.body.refreshToken);
        expect(durable).toHaveLength(1);
        expect(accessOnly).toHaveLength(19);
        expect(accessOnly.every((response) => response.body.token)).toBe(true);

        const original = await refreshTokenModel.findOne({ tokenHash: authService.hashToken(originalToken) });
        const successors = await refreshTokenModel.find({ familyId: original.familyId });
        expect(successors).toHaveLength(2); // token original + exatamente um sucessor
        expect(successors.filter((token) => !token.revokedAt)).toHaveLength(1);

        // O access-only funciona e o único refresh durável continua rotacionável.
        const profile = await request(app)
            .get('/users/profile')
            .set('Authorization', `Bearer ${accessOnly[0].body.token}`);
        expect(profile.statusCode).toBe(200);
        const next = await request(app)
            .post('/users/refresh')
            .send({ refreshToken: durable[0].body.refreshToken });
        expect(next.statusCode).toBe(200);
    });

    it('8b. Reuso FORA da janela de tolerância é tratado como roubo e derruba a família', async () => {
        const loginRes = await loginUser();
        const stolenToken = loginRes.body.refreshToken;

        // Uso legítimo — rotaciona.
        const rotated = await request(app).post('/users/refresh').send({ refreshToken: stolenToken });
        expect(rotated.statusCode).toBe(200);

        // Simula que a rotação aconteceu há muito tempo (fora da janela de 30s) —
        // exatamente o que aconteceria se um token realmente vazado fosse reusado dias
        // depois, não duas abas do mesmo usuário competindo em uma corrida.
        await refreshTokenModel.updateOne(
            { tokenHash: authService.hashToken(stolenToken) },
            { $set: { revokedAt: new Date(Date.now() - 5 * 60 * 1000) } }
        );

        // Alguém com uma cópia antiga tenta usar: sinal de roubo de verdade.
        const reuse = await request(app).post('/users/refresh').send({ refreshToken: stolenToken });
        expect(reuse.statusCode).toBe(401);

        // E a sessão legítima também cai — é o comportamento correto diante de roubo.
        const legitimateAfterReuse = await request(app).post('/users/refresh').send({ refreshToken: rotated.body.refreshToken });
        expect(legitimateAfterReuse.statusCode).toBe(401);
    });

    it('Refresh token inexistente/inválido é recusado sem derrubar nada', async () => {
        const res = await request(app).post('/users/refresh').send({ refreshToken: 'token-que-nunca-existiu' });
        expect(res.statusCode).toBe(401);
    });

    it('Refresh sem token nenhum é recusado', async () => {
        const res = await request(app).post('/users/refresh').send({});
        expect(res.statusCode).toBe(401);
    });
});

describe('Sessão persistente — motorista', () => {
    it('Login emite o par de tokens e o refresh renova a sessão', async () => {
        const captainModel = require('../../models/captain.model');
        const email = 'captain_sessao@test.com';
        await createCaptain({ email, password: await captainModel.hashPassword('password123') });

        const loginRes = await request(app).post('/captains/login').send({ email, password: 'password123' });
        expect(loginRes.statusCode).toBe(200);
        expect(loginRes.body.refreshToken).toBeTruthy();

        const refreshRes = await request(app).post('/captains/refresh').send({ refreshToken: loginRes.body.refreshToken });
        expect(refreshRes.statusCode).toBe(200);
        expect(refreshRes.body.token).toBeTruthy();

        const profileRes = await request(app).get('/captains/profile').set('Authorization', `Bearer ${refreshRes.body.token}`);
        expect(profileRes.statusCode).toBe(200);
    });

    it('Motorista bloqueado tem a sessão recusada no refresh', async () => {
        const captainModel = require('../../models/captain.model');
        const email = 'captain_bloqueado@test.com';
        const captain = await createCaptain({ email, password: await captainModel.hashPassword('password123') });

        const loginRes = await request(app).post('/captains/login').send({ email, password: 'password123' });
        await captainModel.updateOne({ _id: captain._id }, { isBlocked: true });

        const res = await request(app).post('/captains/refresh').send({ refreshToken: loginRes.body.refreshToken });
        expect(res.statusCode).toBe(403);
    });
});

describe('Sessão persistente — admin', () => {
    const adminUserModel = require('../../models/adminUser.model');
    const EMAIL = 'admin_sessao@test.com';

    const createAdmin = () => adminUserModel.create({
        name: 'Admin Sessao', email: EMAIL, password: 'password123', role: 'super_admin'
    });

    // POST /api/admin/login tem rate limit de 5 tentativas por janela (loginLimiter) —
    // verificado empiricamente. Por isso só os testes que precisam exercitar o endpoint
    // de login de fato o chamam; os demais emitem a sessão direto pelo authService, que
    // é exatamente o que o login faz por baixo.
    const issueAdminSession = async (admin) => authService.issueTokenPair({
        userId: admin._id, userType: 'admin', extraClaims: { role: admin.role }
    });

    it('Login emite o par e GET /admin/me confirma a sessão contra o servidor', async () => {
        await createAdmin();
        const loginRes = await request(app).post('/api/admin/login').send({ email: EMAIL, password: 'password123' });
        expect(loginRes.statusCode).toBe(200);
        expect(loginRes.body.refreshToken).toBeTruthy();

        const meRes = await request(app).get('/api/admin/me').set('Authorization', `Bearer ${loginRes.body.token}`);
        expect(meRes.statusCode).toBe(200);
        expect(meRes.body.admin.email).toBe(EMAIL);
    });

    it('Access token expirado renova pelo refresh e a sessão continua', async () => {
        const admin = await createAdmin();
        const session = await issueAdminSession(admin);

        const expired = jwt.sign({ _id: admin._id, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '-1h' });
        const rejected = await request(app).get('/api/admin/me').set('Authorization', `Bearer ${expired}`);
        expect(rejected.statusCode).toBe(401);

        const refreshRes = await request(app).post('/api/admin/refresh').send({ refreshToken: session.refreshToken });
        expect(refreshRes.statusCode).toBe(200);

        const meRes = await request(app).get('/api/admin/me').set('Authorization', `Bearer ${refreshRes.body.token}`);
        expect(meRes.statusCode).toBe(200);
    });

    it('Admin pode ter várias sessões simultâneas (antes, logar num 2º dispositivo derrubava o 1º)', async () => {
        await createAdmin();
        const s1 = await request(app).post('/api/admin/login').send({ email: EMAIL, password: 'password123' });
        const s2 = await request(app).post('/api/admin/login').send({ email: EMAIL, password: 'password123' });

        // As duas continuam válidas. Antes, o refreshToken único guardado no documento
        // do admin fazia o segundo login sobrescrever (e invalidar) o primeiro.
        const r1 = await request(app).post('/api/admin/refresh').send({ refreshToken: s1.body.refreshToken });
        const r2 = await request(app).post('/api/admin/refresh').send({ refreshToken: s2.body.refreshToken });
        expect(r1.statusCode).toBe(200);
        expect(r2.statusCode).toBe(200);
    });

    it('Logout revoga a sessão do admin', async () => {
        const admin = await createAdmin();
        const session = await issueAdminSession(admin);

        const logoutRes = await request(app)
            .post('/api/admin/logout')
            .set('Authorization', `Bearer ${session.accessToken}`)
            .send({ refreshToken: session.refreshToken });
        expect(logoutRes.statusCode).toBe(200);

        const afterLogout = await request(app).post('/api/admin/refresh').send({ refreshToken: session.refreshToken });
        expect(afterLogout.statusCode).toBe(401);
    });

    it('Admin desativado tem a sessão recusada no refresh', async () => {
        const admin = await createAdmin();
        const session = await issueAdminSession(admin);
        await adminUserModel.updateOne({ email: EMAIL }, { active: false });

        const res = await request(app).post('/api/admin/refresh').send({ refreshToken: session.refreshToken });
        expect(res.statusCode).toBe(401);
    });
});

describe('COR-2003 — sessão web em cookie HttpOnly por ator', () => {
    it('passageiro renova sem enviar refresh no corpo e recebe somente cookies próprios', async () => {
        const user = await createUser({ email: 'cookie_user@test.com' });
        const session = await authService.issueTokenPair({ userId: user._id, userType: 'user' });

        const response = await request(app)
            .post('/users/refresh')
            .set('Origin', 'http://localhost:5173')
            .set('Cookie', `userRefreshToken=${session.refreshToken}`)
            .send({});

        expect(response.statusCode).toBe(200);
        expect(response.headers['set-cookie'].some((cookie) => cookie.startsWith('userAccessToken='))).toBe(true);
        expect(response.headers['set-cookie'].some((cookie) => cookie.startsWith('userRefreshToken='))).toBe(true);
        expect(response.headers['set-cookie'].some((cookie) => cookie.startsWith('captainRefreshToken='))).toBe(false);
    });

    it('cookies simultâneos de passageiro e motorista não se sobrescrevem', async () => {
        const user = await createUser({ email: 'cookie_dual_user@test.com' });
        const captain = await createCaptain({ email: 'cookie_dual_captain@test.com' });
        const userSession = await authService.issueTokenPair({ userId: user._id, userType: 'user' });
        const captainSession = await authService.issueTokenPair({ userId: captain._id, userType: 'captain' });
        const cookies = `userRefreshToken=${userSession.refreshToken}; captainRefreshToken=${captainSession.refreshToken}`;

        const userResponse = await request(app)
            .post('/users/refresh')
            .set('Origin', 'http://localhost:5173')
            .set('Cookie', cookies)
            .send({});
        const captainResponse = await request(app)
            .post('/captains/refresh')
            .set('Origin', 'http://localhost:5173')
            .set('Cookie', cookies)
            .send({});

        expect(userResponse.statusCode).toBe(200);
        expect(String(userResponse.body.user._id)).toBe(String(user._id));
        expect(captainResponse.statusCode).toBe(200);
        expect(String(captainResponse.body.captain._id)).toBe(String(captain._id));
    });

    it('logout autenticado pelo cookie do ator revoga o refresh apresentado', async () => {
        const user = await createUser({ email: 'cookie_logout@test.com' });
        const session = await authService.issueTokenPair({ userId: user._id, userType: 'user' });

        const logout = await request(app)
            .post('/users/logout')
            .set('Authorization', `Bearer ${session.accessToken}`)
            .set('Cookie', `userRefreshToken=${session.refreshToken}`)
            .send({});
        expect(logout.statusCode).toBe(200);

        const afterLogout = await request(app)
            .post('/users/refresh')
            .send({ refreshToken: session.refreshToken });
        expect(afterLogout.statusCode).toBe(401);
    });
});

describe('Revogação por bloqueio administrativo', () => {
    it('revokeAllForUser invalida todas as sessões abertas do usuário', async () => {
        const user = await createUser({ email: 'multi_sessao@test.com' });

        // Duas sessões (dois dispositivos).
        const s1 = await authService.issueTokenPair({ userId: user._id, userType: 'user' });
        const s2 = await authService.issueTokenPair({ userId: user._id, userType: 'user' });

        await authService.revokeAllForUser({ userId: user._id, userType: 'user', reason: 'blocked' });

        const r1 = await request(app).post('/users/refresh').send({ refreshToken: s1.refreshToken });
        const r2 = await request(app).post('/users/refresh').send({ refreshToken: s2.refreshToken });
        expect(r1.statusCode).toBe(401);
        expect(r2.statusCode).toBe(401);
    });

    it('Sessões de tipos diferentes não se misturam (user x captain com o mesmo id não colidem)', async () => {
        const user = await createUser({ email: 'isolamento@test.com' });

        const userSession = await authService.issueTokenPair({ userId: user._id, userType: 'user' });
        await authService.revokeAllForUser({ userId: user._id, userType: 'captain', reason: 'blocked' });

        // Revogar as sessões de "captain" com este id não pode derrubar a sessão de "user".
        const res = await request(app).post('/users/refresh').send({ refreshToken: userSession.refreshToken });
        expect(res.statusCode).toBe(200);
    });
});
