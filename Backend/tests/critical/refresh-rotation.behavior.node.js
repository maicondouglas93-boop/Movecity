const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'legacy-secret-for-refresh';
process.env.JWT_ACCESS_SECRET = 'access-secret-for-refresh';
process.env.JWT_ADMIN_SECRET = 'admin-secret-for-refresh';
process.env.JWT_SHARE_SECRET = 'share-secret-for-refresh';
process.env.JWT_ACCEPT_LEGACY_TOKENS = 'false';

const mongoose = require('mongoose');
const refreshTokenModel = require('../../models/refreshToken.model');
const authService = require('../../services/auth.service');

const USER_ID = '66c000000000000000000077';

function cloneDoc(doc) {
    if (!doc) return doc;
    return {
        ...doc,
        expiresAt: new Date(doc.expiresAt),
        revokedAt: doc.revokedAt ? new Date(doc.revokedAt) : null,
    };
}

function matches(doc, filter) {
    if (!doc) return false;
    return Object.entries(filter).every(([key, expected]) => {
        if (key === '_id') return String(doc._id) === String(expected);
        if (key === 'expiresAt' && expected?.$gt) return doc.expiresAt > expected.$gt;
        return doc[key] === expected;
    });
}

function installInMemoryStore(t, initialDocs, { failCreate = false } = {}) {
    let docs = initialDocs.map(cloneDoc);
    let createCalls = 0;
    const originals = {
        startSession: mongoose.startSession,
        findOne: refreshTokenModel.findOne,
        findOneAndUpdate: refreshTokenModel.findOneAndUpdate,
        create: refreshTokenModel.create,
        updateMany: refreshTokenModel.updateMany,
    };

    mongoose.startSession = async () => ({
        async withTransaction(callback) {
            const snapshot = docs.map(cloneDoc);
            try {
                return await callback();
            } catch (error) {
                docs = snapshot;
                throw error;
            }
        },
        async endSession() {},
    });
    refreshTokenModel.findOne = async (filter) => cloneDoc(docs.find((doc) => matches(doc, filter)));
    refreshTokenModel.findOneAndUpdate = async (filter, update) => {
        const index = docs.findIndex((doc) => matches(doc, filter));
        if (index === -1) return null;
        docs[index] = { ...docs[index], ...(update.$set || {}) };
        return cloneDoc(docs[index]);
    };
    refreshTokenModel.create = async (items) => {
        createCalls += 1;
        if (failCreate) throw new Error('falha injetada ao criar sucessor');
        docs.push(...items.map((item, index) => cloneDoc({ _id: `successor-${createCalls}-${index}`, ...item })));
        return items;
    };
    refreshTokenModel.updateMany = async (filter, update) => {
        let modifiedCount = 0;
        docs = docs.map((doc) => {
            if (!matches(doc, filter)) return doc;
            modifiedCount += 1;
            return { ...doc, ...(update.$set || {}) };
        });
        return { modifiedCount };
    };

    t.after(() => {
        mongoose.startSession = originals.startSession;
        refreshTokenModel.findOne = originals.findOne;
        refreshTokenModel.findOneAndUpdate = originals.findOneAndUpdate;
        refreshTokenModel.create = originals.create;
        refreshTokenModel.updateMany = originals.updateMany;
    });

    return {
        docs: () => docs.map(cloneDoc),
        createCalls: () => createCalls,
    };
}

function liveOriginal(rawToken = 'refresh-original') {
    return {
        _id: 'original-id',
        tokenHash: authService.hashToken(rawToken),
        userId: USER_ID,
        userType: 'user',
        familyId: 'family-original',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        revokedAt: null,
        revokedReason: null,
        replacedBy: null,
    };
}

test('20 rotações concorrentes criam exatamente um sucessor durável', async (t) => {
    const rawToken = 'refresh-original';
    const store = installInMemoryStore(t, [liveOriginal(rawToken)]);

    const results = await Promise.all(Array.from({ length: 20 }, () => (
        authService.rotateRefreshToken({ refreshToken: rawToken, expectedUserType: 'user', ip: '127.0.0.1' })
    )));

    const durable = results.filter((result) => result.refreshToken);
    const graceOnly = results.filter((result) => result.graceAccessOnly);
    const original = store.docs().find((doc) => doc._id === 'original-id');
    const successors = store.docs().filter((doc) => doc._id !== 'original-id');

    assert.equal(durable.length, 1);
    assert.equal(graceOnly.length, 19);
    assert.equal(store.createCalls(), 1);
    assert.equal(successors.length, 1);
    assert.equal(original.replacedBy, successors[0].tokenHash);
    assert.equal(successors[0].familyId, original.familyId);
    assert.ok(graceOnly.every((result) => result.refreshToken === null));
    assert.equal(authService.getTokenPolicyMetrics().refreshRotated, 1);
    assert.equal(authService.getTokenPolicyMetrics().refreshGraceAccessOnly, 19);
});

test('falha ao criar sucessor aborta a revogação do token original', async (t) => {
    const rawToken = 'refresh-com-falha';
    const store = installInMemoryStore(t, [liveOriginal(rawToken)], { failCreate: true });

    await assert.rejects(
        authService.rotateRefreshToken({ refreshToken: rawToken, expectedUserType: 'user' }),
        /falha injetada/
    );

    const original = store.docs()[0];
    assert.equal(original.revokedAt, null);
    assert.equal(original.replacedBy, null);
    assert.equal(store.docs().length, 1);
});

test('reuso fora da graça revoga somente a família comprometida', async (t) => {
    const rawToken = 'refresh-antigo';
    const old = liveOriginal(rawToken);
    old.revokedAt = new Date(Date.now() - 5 * 60 * 1000);
    old.revokedReason = 'rotated';
    old.replacedBy = 'successor-hash';
    const successor = {
        ...liveOriginal('outro-token'),
        _id: 'successor-id',
        tokenHash: 'successor-hash',
    };
    const anotherFamily = {
        ...liveOriginal('sessao-independente'),
        _id: 'other-family-id',
        familyId: 'family-independent',
    };
    const store = installInMemoryStore(t, [old, successor, anotherFamily]);

    await assert.rejects(
        authService.rotateRefreshToken({ refreshToken: rawToken, expectedUserType: 'user' }),
        { code: 'REFRESH_TOKEN_REUSE' }
    );

    const docs = store.docs();
    assert.ok(docs.find((doc) => doc._id === 'successor-id').revokedAt);
    assert.equal(docs.find((doc) => doc._id === 'other-family-id').revokedAt, null);
    assert.equal(authService.getTokenPolicyMetrics().refreshReuseDetected, 1);
});
