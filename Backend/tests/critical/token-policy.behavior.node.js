const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'legacy-secret-for-contract';
process.env.JWT_ACCESS_SECRET = 'access-secret-for-contract';
process.env.JWT_ADMIN_SECRET = 'admin-secret-for-contract';
process.env.JWT_SHARE_SECRET = 'share-secret-for-contract';
process.env.JWT_ISSUER = 'movecity-contract-test';
process.env.JWT_ACCEPT_LEGACY_TOKENS = 'false';

const authService = require('../../services/auth.service');

const IDS = {
    user: '66c000000000000000000001',
    captain: '66c000000000000000000002',
    admin: '66c000000000000000000003',
    ride: '66c000000000000000000004',
};

test('tokens v2 carregam contrato completo e verificam no ator correto', () => {
    for (const actorType of ['user', 'captain', 'admin']) {
        const token = authService.generateAccessToken(IDS[actorType], actorType, { role: 'operador' });
        const decoded = authService.verifyAccessToken(token, actorType);

        assert.equal(decoded.sub, IDS[actorType]);
        assert.equal(decoded._id, IDS[actorType]);
        assert.equal(decoded.subjectId, IDS[actorType]);
        assert.equal(decoded.actorType, actorType);
        assert.equal(decoded.tokenType, 'access');
        assert.equal(decoded.ver, 2);
        assert.equal(decoded.iss, 'movecity-contract-test');
        assert.equal(decoded.aud, `movecity:${actorType}`);
        assert.ok(decoded.jti);
        assert.equal(decoded.legacy, false);
    }
});

test('claims reservados não podem sobrescrever ator, finalidade ou subject', () => {
    const token = authService.generateAccessToken(IDS.user, 'user', {
        _id: IDS.captain,
        sub: IDS.captain,
        actorType: 'admin',
        tokenType: 'share',
        ver: 1,
        role: 'passenger',
    });
    const decoded = authService.verifyAccessToken(token, 'user');

    assert.equal(decoded.sub, IDS.user);
    assert.equal(decoded._id, IDS.user);
    assert.equal(decoded.actorType, 'user');
    assert.equal(decoded.tokenType, 'access');
    assert.equal(decoded.ver, 2);
    assert.equal(decoded.role, 'passenger');
});

test('token válido de um ator é rejeitado pelos outros middlewares lógicos', () => {
    const userToken = authService.generateAccessToken(IDS.user, 'user');
    const captainToken = authService.generateAccessToken(IDS.captain, 'captain');
    const adminToken = authService.generateAccessToken(IDS.admin, 'admin');

    assert.throws(() => authService.verifyAccessToken(userToken, 'captain'), { code: 'TOKEN_ACTOR_MISMATCH' });
    assert.throws(() => authService.verifyAccessToken(captainToken, 'user'), { code: 'TOKEN_ACTOR_MISMATCH' });
    assert.throws(() => authService.verifyAccessToken(adminToken, ['user', 'captain']), { code: 'TOKEN_ACTOR_MISMATCH' });
});

test('segredo de ADM não valida como access comum e vice-versa', () => {
    const userToken = authService.generateAccessToken(IDS.user, 'user');
    const adminToken = authService.generateAccessToken(IDS.admin, 'admin');

    assert.throws(() => jwt.verify(adminToken, process.env.JWT_ACCESS_SECRET));
    assert.throws(() => jwt.verify(userToken, process.env.JWT_ADMIN_SECRET));
});

test('produção recusa ADM e share sem os segredos dedicados', (t) => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAdminSecret = process.env.JWT_ADMIN_SECRET;
    const originalShareSecret = process.env.JWT_SHARE_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_ADMIN_SECRET;
    delete process.env.JWT_SHARE_SECRET;
    t.after(() => {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.JWT_ADMIN_SECRET = originalAdminSecret;
        process.env.JWT_SHARE_SECRET = originalShareSecret;
    });

    assert.throws(
        () => authService.generateAccessToken(IDS.admin, 'admin'),
        { code: 'TOKEN_SECRET_NOT_CONFIGURED' }
    );
    assert.throws(
        () => authService.signShareToken({ rideId: IDS.ride, userId: IDS.user }),
        { code: 'TOKEN_SECRET_NOT_CONFIGURED' }
    );
});

test('share token só valida na finalidade e audience de compartilhamento', () => {
    const token = authService.signShareToken({ rideId: IDS.ride, userId: IDS.user });
    const decoded = authService.verifyShareToken(token);

    assert.equal(decoded.sub, IDS.ride);
    assert.equal(decoded.rideId, IDS.ride);
    assert.equal(decoded.userId, IDS.user);
    assert.equal(decoded.tokenType, 'share');
    assert.equal(decoded.aud, 'movecity:ride-share');
    assert.throws(() => authService.verifyAccessToken(token, 'user'));

    const access = authService.generateAccessToken(IDS.user, 'user');
    assert.throws(() => authService.verifyShareToken(access));
});

test('token legado exige feature flag e data de corte futura explícitas', () => {
    const legacy = jwt.sign({ _id: IDS.user }, process.env.JWT_SECRET, { expiresIn: '5m' });
    assert.throws(() => authService.verifyAccessToken(legacy, 'user'), { code: 'LEGACY_TOKEN_REJECTED' });

    process.env.JWT_ACCEPT_LEGACY_TOKENS = 'true';
    process.env.JWT_LEGACY_ACCEPT_UNTIL = '2099-01-01T00:00:00.000Z';
    const accepted = authService.verifyAccessToken(legacy, 'user');
    assert.equal(accepted.subjectId, IDS.user);
    assert.equal(accepted.legacy, true);

    process.env.JWT_LEGACY_ACCEPT_UNTIL = '2000-01-01T00:00:00.000Z';
    assert.throws(() => authService.verifyAccessToken(legacy, 'user'), { code: 'LEGACY_TOKEN_REJECTED' });
});

test('refresh de outro ator falha antes de criar ou alterar qualquer token', async (t) => {
    const refreshTokenModel = require('../../models/refreshToken.model');
    const originalFindOne = refreshTokenModel.findOne;
    const originalCreate = refreshTokenModel.create;
    const stored = {
        userId: IDS.captain,
        userType: 'captain',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        saveCalls: 0,
        async save() { this.saveCalls += 1; },
    };
    let createCalls = 0;

    refreshTokenModel.findOne = async () => stored;
    refreshTokenModel.create = async () => { createCalls += 1; };
    t.after(() => {
        refreshTokenModel.findOne = originalFindOne;
        refreshTokenModel.create = originalCreate;
    });

    await assert.rejects(
        authService.rotateRefreshToken({
            refreshToken: 'captain-refresh-presented-on-user-route',
            expectedUserType: 'user',
            ip: '127.0.0.1',
        }),
        { code: 'REFRESH_ACTOR_MISMATCH' }
    );
    assert.equal(createCalls, 0);
    assert.equal(stored.saveCalls, 0);
});
