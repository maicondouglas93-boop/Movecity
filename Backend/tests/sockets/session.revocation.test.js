'use strict';

jest.mock('../../notification/notificationDispatcher.service', () => ({
    sendChatMessageToCaptain: jest.fn(),
    sendChatMessageToUser: jest.fn(),
}));

const crypto = require('node:crypto');
const { createServer } = require('node:http');
const jwt = require('jsonwebtoken');
const Client = require('socket.io-client');
const { initializeSocket } = require('../../socket');
const authService = require('../../services/auth.service');
const socketSessionModel = require('../../models/socketSession.model');
const { createUser } = require('../factories/user.factory');

describe('revogação de identidade Socket.IO', () => {
    let httpServer;
    let io;
    const clients = new Set();

    const port = () => httpServer.address().port;

    const connectClient = () => new Promise((resolve, reject) => {
        const socket = new Client(`http://127.0.0.1:${port()}`, {
            forceNew: true,
            reconnection: false,
            transports: ['websocket'],
        });
        clients.add(socket);
        const timer = setTimeout(() => reject(new Error('Timeout conectando Socket.IO')), 5000);
        socket.once('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });
        socket.once('connect_error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });

    const joinUser = (socket, user, token, deviceId) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout aguardando ack do join')), 5000);
        socket.emit('join', {
            userId: user._id.toString(),
            userType: 'user',
            token,
            deviceId,
        }, (ack) => {
            clearTimeout(timer);
            if (!ack?.ok) return reject(new Error(ack?.message || 'Join rejeitado'));
            return resolve(ack);
        });
    });

    const onceWithTimeout = (socket, event, timeoutMs = 5000) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout aguardando ${event}`)), timeoutMs);
        socket.once(event, (payload) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });

    beforeAll(async () => {
        httpServer = createServer();
        io = initializeSocket(httpServer);
        await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    });

    afterEach(() => {
        for (const socket of clients) socket.close();
        clients.clear();
    });

    afterAll(async () => {
        for (const socket of clients) socket.close();
        clients.clear();
        if (io) await new Promise((resolve) => io.close(resolve));
        if (httpServer?.listening) {
            await new Promise((resolve) => httpServer.close(resolve));
        }
    });

    it('bloqueio/revogação de conta encerra todas as abas e registra cada conexão', async () => {
        const user = await createUser();
        const tokenA = authService.generateAccessToken(user._id, 'user');
        const tokenB = authService.generateAccessToken(user._id, 'user');
        const [tabA, tabB] = await Promise.all([connectClient(), connectClient()]);

        await Promise.all([
            joinUser(tabA, user, tokenA, 'test-device-account-a'),
            joinUser(tabB, user, tokenB, 'test-device-account-b'),
        ]);

        const sessions = await socketSessionModel.find({
            actorType: 'user',
            actorId: user._id,
            disconnectedAt: null,
        }).lean();
        expect(sessions).toHaveLength(2);
        expect(new Set(sessions.map((session) => session.jti)).size).toBe(2);
        expect(new Set(sessions.map((session) => session.deviceIdHash)).size).toBe(2);

        const revokedA = onceWithTimeout(tabA, 'session-revoked');
        const revokedB = onceWithTimeout(tabB, 'session-revoked');
        await authService.revokeAllForUser({
            userId: user._id,
            userType: 'user',
            reason: 'blocked',
        });

        await expect(Promise.all([revokedA, revokedB])).resolves.toEqual([
            expect.objectContaining({ code: 'SESSION_REVOKED', reason: 'blocked' }),
            expect.objectContaining({ code: 'SESSION_REVOKED', reason: 'blocked' }),
        ]);
        expect(tabA.connected).toBe(false);
        expect(tabB.connected).toBe(false);
    });

    it('logout por JTI encerra somente a sessão apresentada', async () => {
        const user = await createUser();
        const tokenA = authService.generateAccessToken(user._id, 'user');
        const tokenB = authService.generateAccessToken(user._id, 'user');
        const decodedA = authService.verifyAccessToken(tokenA, 'user');
        const [deviceA, deviceB] = await Promise.all([connectClient(), connectClient()]);

        await Promise.all([
            joinUser(deviceA, user, tokenA, 'test-device-logout-aa'),
            joinUser(deviceB, user, tokenB, 'test-device-logout-bb'),
        ]);

        const revoked = onceWithTimeout(deviceA, 'session-revoked');
        await authService.revokeAccessSession({
            userId: user._id,
            userType: 'user',
            jti: decodedA.jti,
            reason: 'logout',
        });
        await expect(revoked).resolves.toEqual(
            expect.objectContaining({ code: 'SESSION_REVOKED', reason: 'logout' })
        );

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(deviceA.connected).toBe(false);
        expect(deviceB.connected).toBe(true);
    });

    it('access token expirado perde a identidade e as salas sem manter autorização antiga', async () => {
        const user = await createUser();
        const subjectId = user._id.toString();
        const token = jwt.sign({
            _id: subjectId,
            actorType: 'user',
            tokenType: 'access',
            ver: authService.TOKEN_VERSION,
        }, process.env.JWT_ACCESS_SECRET, {
            algorithm: 'HS256',
            expiresIn: '1s',
            subject: subjectId,
            issuer: authService.TOKEN_ISSUER,
            audience: authService.AUDIENCE_BY_ACTOR.user,
            jwtid: crypto.randomUUID(),
        });
        const socket = await connectClient();
        await joinUser(socket, user, token, 'test-device-expiry-aaa');

        const reauth = onceWithTimeout(socket, 'reauth-required');
        await expect(reauth).resolves.toEqual(
            expect.objectContaining({ code: 'ACCESS_TOKEN_EXPIRED' })
        );
        expect(socket.connected).toBe(true);

        const session = await socketSessionModel.findOne({ socketId: socket.id }).lean();
        expect(session.disconnectedAt).toBeInstanceOf(Date);
        expect(session.disconnectReason).toBe('access_token_expired');
    });
});
