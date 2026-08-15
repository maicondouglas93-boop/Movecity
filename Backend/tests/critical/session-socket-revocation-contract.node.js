'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(backendRoot, '..');
const readBackend = (file) => fs.readFileSync(path.join(backendRoot, file), 'utf8');
const readRepo = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('registro de socket identifica ator, JTI, dispositivo, instância e expiração', () => {
    const model = readBackend('models/socketSession.model.js');
    for (const field of ['actorType', 'actorId', 'jti', 'deviceIdHash', 'instanceId', 'socketId', 'tokenExpiresAt']) {
        assert.match(model, new RegExp(field));
    }
    assert.match(model, /purgeAt/);
    assert.match(model, /expireAfterSeconds/);
});

test('evento persistente de revogação suporta conta inteira ou JTI e TTL', () => {
    const model = readBackend('models/sessionRevocationEvent.model.js');
    assert.match(model, /scope/);
    assert.match(model, /account/);
    assert.match(model, /session/);
    assert.match(model, /jti/);
    assert.match(model, /expireAfterSeconds/);
});

test('barramento invalida cache local e propaga por change stream mais polling', () => {
    const service = readBackend('services/sessionRevocation.service.js');
    assert.match(service, /deleteByPrefix\(`profile:user:/);
    assert.match(service, /deleteByPrefix\(`profile:captain:/);
    assert.match(service, /\.watch\s*\(/);
    assert.match(service, /poll/i);
    assert.match(service, /publishRevocation/);
});

test('revogação global publica evento e logouts revogam o JTI atual', () => {
    const auth = readBackend('services/auth.service.js');
    const controllers = [
        readBackend('controllers/user.controller.js'),
        readBackend('controllers/captain.controller.js'),
        readBackend('controllers/admin.controller.js'),
    ].join('\n');
    assert.match(auth, /publishRevocation/);
    assert.match(auth, /revokeAccessSession/);
    assert.match(controllers, /req\.auth\?\.jti|req\.auth\.jti/);
    assert.match(controllers, /revokeAccessSession/);
});

test('socket usa sala por ator, persiste sessão, revalida e expira identidade', () => {
    const socket = readBackend('socket.js');
    assert.match(socket, /actorRoom/);
    assert.match(socket, /bindSocketIdentity/);
    assert.match(socket, /revalidateSocketIdentity/);
    assert.match(socket, /tokenExpiresAt/);
    assert.match(socket, /reauth-required/);
    assert.match(socket, /socketSessionModel/);
});

test('revogação encerra todos os sockets locais do ator e pode filtrar por JTI', () => {
    const socket = readBackend('socket.js');
    assert.match(socket, /disconnectRevokedSockets/);
    assert.match(socket, /event\.jti/);
    assert.match(socket, /socket\.disconnect\(true\)/);
    assert.doesNotMatch(socket, /disconnectSocket\(user\.socketId\)/);
});

test('cache hit de passageiro revalida flag de bloqueio no Mongo', () => {
    const service = readBackend('services/user.service.js');
    assert.match(service, /cachedUser/);
    assert.match(service, /select\(['"]isBlocked['"]\)/);
    assert.match(service, /flags\.isBlocked/);
});

test('clientes enviam ID não secreto do dispositivo e refazem join após expiração', () => {
    const socketAuth = readRepo('frontend/src/shared/services/socketAuth.js');
    const rideChat = readRepo('frontend/src/shared/components/RideChat.jsx');
    const adminSocket = readRepo('admin-frontend/src/contexts/SocketContext.jsx');
    assert.match(socketAuth, /getDeviceId/);
    assert.match(socketAuth, /reauth-required/);
    assert.match(rideChat, /identity-restored/);
    assert.match(rideChat, /getDeviceId/);
    assert.match(adminSocket, /getDeviceId/);
    assert.match(adminSocket, /reauth-required/);
    assert.match(adminSocket, /joinAdminWithRetry/);
});

test('CI executa o contrato crítico de revogação de sockets', () => {
    const pkg = readBackend('package.json');
    const ci = readRepo('.github/workflows/ci.yml');
    assert.match(pkg, /test:critical:session-revocation/);
    assert.match(ci, /test:critical:session-revocation/);
});

test('CI executa a integração multiaba em Mongo replica set', () => {
    const pkg = readBackend('package.json');
    const ci = readRepo('.github/workflows/ci.yml');
    assert.match(pkg, /test:integration:session-revocation/);
    assert.match(ci, /test:integration:session-revocation/);
});
