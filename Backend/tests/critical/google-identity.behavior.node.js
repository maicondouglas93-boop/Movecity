'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeEmail,
    validateGoogleIdentityClaims,
    isLegacyGoogleEmailLinkEnabled,
    confirmExistingGoogleAccountLink,
} = require('../../utils/googleIdentity');

test('normalização é determinística e claims Google precisam estar verificadas', () => {
    assert.equal(normalizeEmail('  CLIENTE@EXAMPLE.COM  '), 'cliente@example.com');
    assert.deepEqual(
        validateGoogleIdentityClaims({
            uid: 'uid-1',
            email: ' CLIENTE@EXAMPLE.COM ',
            email_verified: true,
            firebase: { sign_in_provider: 'google.com' },
        }),
        { uid: 'uid-1', email: 'cliente@example.com', name: '', picture: '' }
    );

    assert.throws(
        () => validateGoogleIdentityClaims({
            uid: 'uid-1',
            email: 'cliente@example.com',
            email_verified: true,
            firebase: { sign_in_provider: 'password' },
        }),
        { code: 'GOOGLE_PROVIDER_INVALID' }
    );
});

test('janela legada só abre com opt-in e prazo futuro', () => {
    const now = Date.parse('2026-08-15T12:00:00.000Z');
    assert.equal(isLegacyGoogleEmailLinkEnabled({
        allowLegacyEmailLink: 'true',
        legacyLinkUntil: '2026-08-16T12:00:00.000Z',
        now,
    }), true);
    assert.equal(isLegacyGoogleEmailLinkEnabled({
        allowLegacyEmailLink: 'false',
        legacyLinkUntil: '2026-08-16T12:00:00.000Z',
        now,
    }), false);
    assert.equal(isLegacyGoogleEmailLinkEnabled({
        allowLegacyEmailLink: 'true',
        legacyLinkUntil: '2026-08-14T12:00:00.000Z',
        now,
    }), false);
});

test('conta local existente exige senha válida fora da janela legada', async () => {
    const user = { comparePassword: async (password) => password === 'correta' };

    await assert.rejects(
        confirmExistingGoogleAccountLink({ user, password: '', allowLegacyLink: false }),
        { code: 'GOOGLE_LINK_PASSWORD_REQUIRED', statusCode: 409 }
    );
    await assert.rejects(
        confirmExistingGoogleAccountLink({ user, password: 'errada', allowLegacyLink: false }),
        { code: 'GOOGLE_LINK_PASSWORD_INVALID', statusCode: 401 }
    );
    assert.equal(await confirmExistingGoogleAccountLink({ user, password: 'correta' }), 'password');
    assert.equal(await confirmExistingGoogleAccountLink({ user, allowLegacyLink: true }), 'legacy-window');
});

test('serialização do usuário elimina senha e UID mesmo quando foram selecionados', () => {
    const User = require('../../models/user.model');
    const user = new User({
        fullname: { firstname: 'Pessoa' },
        email: ' PESSOA@EXAMPLE.COM ',
        password: 'hash-que-nao-pode-vazar',
        firebaseUid: 'firebase-uid-secreto',
    });
    const json = user.toJSON();

    assert.equal(json.email, 'pessoa@example.com');
    assert.equal(Object.hasOwn(json, 'password'), false);
    assert.equal(Object.hasOwn(json, 'firebaseUid'), false);
});

test('auditor somente leitura detecta e-mails equivalentes sem expor o endereço', async () => {
    const { buildAudit } = require('../../scripts/audit-user-email-identities');
    const users = [
        { _id: '1', email: 'Pessoa@Example.com', firebaseUid: 'uid-1' },
        { _id: '2', email: ' pessoa@example.COM ', firebaseUid: 'uid-2' },
        { _id: '3', email: 'invalido', firebaseUid: null },
    ];
    const collection = {
        find() {
            return (async function* cursor() {
                for (const user of users) yield user;
            }());
        }
    };

    const report = await buildAudit(collection);
    assert.equal(report.readOnly, true);
    assert.equal(report.summary.normalizedEmailCollisions, 1);
    assert.equal(report.summary.normalizationCandidates, 2);
    assert.equal(report.summary.invalidEmails, 1);
    assert.equal(JSON.stringify(report).includes('pessoa@example.com'), false);
});

test('migração recusa colisões antes de produzir qualquer operação', () => {
    const {
        assertEmailNormalizationMigrationSafe,
    } = require('../../scripts/migrate-user-email-normalization');
    const safeSummary = {
        normalizedEmailCollisions: 0,
        firebaseUidCollisions: 0,
        invalidEmails: 0,
    };

    assert.doesNotThrow(() => assertEmailNormalizationMigrationSafe({ summary: safeSummary }));
    for (const field of Object.keys(safeSummary)) {
        assert.throws(
            () => assertEmailNormalizationMigrationSafe({
                summary: { ...safeSummary, [field]: 1 },
            }),
            { code: 'EMAIL_NORMALIZATION_CONFLICT' }
        );
    }
});

test('controller consulta UID antes do e-mail e exige confirmação antes de persistir vínculo', async () => {
    const moduleIds = {
        userModel: require.resolve('../../models/user.model'),
        userService: require.resolve('../../services/user.service'),
        validation: require.resolve('express-validator'),
        blacklist: require.resolve('../../models/blacklistToken.model'),
        authService: require.resolve('../../services/auth.service'),
        firebaseAuth: require.resolve('firebase-admin/auth'),
        controller: require.resolve('../../controllers/user.controller'),
    };
    const backups = new Map(Object.values(moduleIds).map((id) => [id, require.cache[id]]));
    let scenario;

    const installMock = (id, exports) => {
        require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    const queryWithSelection = (valueFactory) => ({ select: async () => valueFactory() });

    installMock(moduleIds.userModel, {
        findOne(filter) {
            scenario.events.push(['uid-query', filter]);
            return queryWithSelection(() => scenario.userByUid || null);
        },
        hashPassword: async () => 'hashed',
    });
    installMock(moduleIds.userService, {
        async findUserByNormalizedEmail(email) {
            scenario.events.push(['email-query', email]);
            return scenario.userByEmail || null;
        },
        async createUser(payload) {
            scenario.events.push(['create', payload]);
            return { _id: 'new-user', ...payload, fullname: { firstname: payload.firstname } };
        },
    });
    installMock(moduleIds.validation, {
        validationResult: () => ({ isEmpty: () => true, array: () => [] }),
    });
    installMock(moduleIds.blacklist, { create: async () => undefined });
    installMock(moduleIds.authService, {
        ACCESS_COOKIE_BY_ACTOR: { user: 'userAccessToken' },
        REFRESH_COOKIE_BY_ACTOR: { user: 'userRefreshToken' },
        accessCookieOptions: () => ({ httpOnly: true, maxAge: 1 }),
        refreshCookieOptions: () => ({ httpOnly: true, path: '/users' }),
        shouldExposeRefreshToken: () => false,
        issueTokenPair: async () => {
            scenario.events.push(['issue-session']);
            return { accessToken: 'access', refreshToken: 'refresh' };
        },
    });
    installMock(moduleIds.firebaseAuth, {
        getAuth: () => ({ verifyIdToken: async () => scenario.claims }),
    });
    delete require.cache[moduleIds.controller];
    const controller = require(moduleIds.controller);

    const response = () => ({
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        cookie() { return this; },
        clearCookie() { return this; },
    });
    const validClaims = {
        uid: 'google-uid',
        email: 'Pessoa@Example.com',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
    };
    const localUser = () => ({
        _id: 'local-user',
        email: 'pessoa@example.com',
        password: 'selected-hash',
        firebaseUid: undefined,
        isBlocked: false,
        fullname: { firstname: 'Pessoa' },
        comparePassword: async (value) => value === 'senha-correta',
        async save() { scenario.events.push(['save']); },
    });

    const previousGoogleLoginEnabled = process.env.GOOGLE_LOGIN_ENABLED;
    try {
        process.env.GOOGLE_LOGIN_ENABLED = 'false';
        scenario = { claims: validClaims, events: [], userByUid: null, userByEmail: null };
        let res = response();
        await controller.googleLogin({ body: { idToken: 'token' }, ip: '127.0.0.1' }, res);
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.code, 'GOOGLE_LOGIN_DISABLED');
        assert.deepEqual(scenario.events, []);
        if (previousGoogleLoginEnabled === undefined) delete process.env.GOOGLE_LOGIN_ENABLED;
        else process.env.GOOGLE_LOGIN_ENABLED = previousGoogleLoginEnabled;

        scenario = {
            claims: { ...validClaims, firebase: { sign_in_provider: 'password' } },
            events: [],
            userByUid: null,
            userByEmail: null,
        };
        res = response();
        await controller.googleLogin({ body: { idToken: 'token' }, ip: '127.0.0.1' }, res);
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.code, 'GOOGLE_PROVIDER_INVALID');
        assert.deepEqual(scenario.events, []);

        scenario = { claims: validClaims, events: [], userByUid: null, userByEmail: localUser() };
        res = response();
        await controller.googleLogin({ body: { idToken: 'token' }, ip: '127.0.0.1' }, res);
        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, 'GOOGLE_LINK_PASSWORD_REQUIRED');
        assert.deepEqual(scenario.events.map(([event]) => event), ['uid-query', 'email-query']);
        assert.equal(scenario.userByEmail.firebaseUid, undefined);

        scenario = { claims: validClaims, events: [], userByUid: null, userByEmail: localUser() };
        res = response();
        await controller.googleLogin({
            body: { idToken: 'token', password: 'senha-correta' },
            ip: '127.0.0.1'
        }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(scenario.userByEmail.firebaseUid, 'google-uid');
        assert.deepEqual(
            scenario.events.map(([event]) => event),
            ['uid-query', 'email-query', 'save', 'issue-session']
        );

        const linkedUser = localUser();
        linkedUser.firebaseUid = 'google-uid';
        scenario = { claims: validClaims, events: [], userByUid: linkedUser, userByEmail: null };
        res = response();
        await controller.googleLogin({ body: { idToken: 'token' }, ip: '127.0.0.1' }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(scenario.events.map(([event]) => event), ['uid-query', 'issue-session']);
    } finally {
        if (previousGoogleLoginEnabled === undefined) delete process.env.GOOGLE_LOGIN_ENABLED;
        else process.env.GOOGLE_LOGIN_ENABLED = previousGoogleLoginEnabled;
        for (const [id, cached] of backups) {
            if (cached) require.cache[id] = cached;
            else delete require.cache[id];
        }
    }
});
