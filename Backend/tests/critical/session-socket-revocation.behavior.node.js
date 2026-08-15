'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const dispatcherId = require.resolve('../../notification/notificationDispatcher.service');
const dispatcherBackup = require.cache[dispatcherId];
require.cache[dispatcherId] = {
    id: dispatcherId,
    filename: dispatcherId,
    loaded: true,
    exports: {
        sendChatMessageToCaptain: async () => undefined,
        sendChatMessageToUser: async () => undefined,
    },
};
test.after(() => {
    if (dispatcherBackup) require.cache[dispatcherId] = dispatcherBackup;
    else delete require.cache[dispatcherId];
});

test('revogação de conta encerra todas as abas do ator e revogação de JTI só a sessão alvo', () => {
    const { disconnectRevokedSockets } = require('../../socket');

    const fakeSocket = (type, id, jti) => ({
        data: { identity: { type, id, jti } },
        emitted: [],
        disconnected: false,
        emit(event, payload) { this.emitted.push([event, payload]); },
        disconnect(close) { this.disconnected = close === true; },
    });
    const firstTab = fakeSocket('user', 'user-1', 'jti-1');
    const secondTab = fakeSocket('user', 'user-1', 'jti-2');
    const anotherUser = fakeSocket('user', 'user-2', 'jti-3');
    const captain = fakeSocket('captain', 'user-1', 'jti-4');
    const ioServer = {
        sockets: { sockets: new Map([
            ['a', firstTab],
            ['b', secondTab],
            ['c', anotherUser],
            ['d', captain],
        ]) }
    };

    const sessionCount = disconnectRevokedSockets({
        scope: 'session', actorType: 'user', actorId: 'user-1', jti: 'jti-1', reason: 'logout'
    }, ioServer);
    assert.equal(sessionCount, 1);
    assert.equal(firstTab.disconnected, true);
    assert.equal(secondTab.disconnected, false);

    firstTab.disconnected = false;
    const accountCount = disconnectRevokedSockets({
        scope: 'account', actorType: 'user', actorId: 'user-1', reason: 'blocked'
    }, ioServer);
    assert.equal(accountCount, 2);
    assert.equal(firstTab.disconnected, true);
    assert.equal(secondTab.disconnected, true);
    assert.equal(anotherUser.disconnected, false);
    assert.equal(captain.disconnected, false);
});

test('evento repetido invalida cache e notifica handlers uma única vez', async () => {
    const cache = require('../../cache/cache');
    const {
        applyRevocationEvent,
        registerRevocationHandler,
    } = require('../../services/sessionRevocation.service');
    const event = {
        eventId: 'event-behavior-cache-1',
        scope: 'account',
        actorType: 'user',
        actorId: '507f1f77bcf86cd799439011',
        reason: 'blocked',
        createdAt: new Date(),
    };
    let calls = 0;
    const unregister = registerRevocationHandler(() => { calls += 1; });

    try {
        cache.setCache(`profile:user:${event.actorId}`, { isBlocked: false });
        assert.equal(cache.hasCache(`profile:user:${event.actorId}`), true);
        assert.equal(await applyRevocationEvent(event), true);
        assert.equal(cache.hasCache(`profile:user:${event.actorId}`), false);
        assert.equal(await applyRevocationEvent(event), false);
        assert.equal(calls, 1);
    } finally {
        unregister();
        cache.clearCache();
    }
});

test('evento de sessão sem JTI é inválido e evento de conta continua válido', async () => {
    const SessionRevocationEvent = require('../../models/sessionRevocationEvent.model');
    const actorId = '507f1f77bcf86cd799439011';

    const invalid = new SessionRevocationEvent({
        scope: 'session', actorType: 'user', actorId, reason: 'logout'
    });
    await assert.rejects(invalid.validate(), /exige jti/i);

    const valid = new SessionRevocationEvent({
        scope: 'account', actorType: 'captain', actorId, reason: 'blocked'
    });
    await assert.doesNotReject(valid.validate());
});

test('cache hit do passageiro sempre recebe isBlocked fresco do Mongo', async () => {
    const ids = {
        service: require.resolve('../../services/user.service'),
        model: require.resolve('../../models/user.model'),
        cache: require.resolve('../../cache/cache'),
    };
    const backups = new Map(Object.values(ids).map((id) => [id, require.cache[id]]));
    let flags = { isBlocked: true };
    let deletedKey = null;

    require.cache[ids.model] = {
        id: ids.model,
        filename: ids.model,
        loaded: true,
        exports: {
            findById: () => ({
                select: () => ({ lean: async () => flags }),
            }),
        },
    };
    require.cache[ids.cache] = {
        id: ids.cache,
        filename: ids.cache,
        loaded: true,
        exports: {
            getCache: () => ({ _id: 'user-1', isBlocked: false }),
            setCache: () => true,
            deleteCache: (key) => { deletedKey = key; },
        },
    };
    delete require.cache[ids.service];

    try {
        const service = require(ids.service);
        const blocked = await service.getUserProfile('user-1');
        assert.equal(blocked.isBlocked, true);

        flags = null;
        assert.equal(await service.getUserProfile('user-1'), null);
        assert.equal(deletedKey, 'profile:user:user-1');
    } finally {
        for (const [id, cached] of backups) {
            if (cached) require.cache[id] = cached;
            else delete require.cache[id];
        }
    }
});
