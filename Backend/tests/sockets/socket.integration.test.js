const { createServer } = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { initializeSocket } = require('../../socket');
const userModel = require('../../models/user.model');
const captainModel = require('../../models/captain.model');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { generateAuthToken } = require('../setup/authHelper');

// Auditoria PWA (2026-08-03, C1/C2): antes, `join` de user/captain aceitava qualquer
// `userId` mandado pelo cliente sem verificar token nenhum — qualquer socket conectado
// podia se anunciar como qualquer usuário/motorista real e sequestrar a entrega de
// eventos endereçados por `socketId` (localização, atualização de corrida). Estes
// testes provam o fechamento dessa falha: join sem token/com token de outra pessoa é
// rejeitado, e `update-location-captain` só aceita a identidade autenticada no join
// desta mesma conexão, nunca o `userId` solto do payload.
describe('Socket.IO Integration Tests', () => {
    let io, httpServer, clientSocket;
    let user, captain;

    const connectClient = (port) => new Promise((resolve) => {
        const socket = new Client(`http://localhost:${port}`);
        socket.on('connect', () => resolve(socket));
    });

    beforeAll((done) => {
        httpServer = createServer();
        // initializeSocket expects an httpServer
        initializeSocket(httpServer);

        httpServer.listen(() => {
            done();
        });
    });

    afterAll((done) => {
        setTimeout(() => {
            io && io.close();
            httpServer.close();
            done();
        }, 200);
    });

    afterEach(() => {
        if (clientSocket) clientSocket.close();
    });

    beforeEach(async () => {
        user = await createUser();
        captain = await createCaptain();
    });

    const port = () => httpServer.address().port;

    it('join com token válido autentica e atualiza o socketId do usuário', (done) => {
        connectClient(port()).then((socket) => {
            clientSocket = socket;
            socket.emit('join', { userId: user._id, userType: 'user', token: generateAuthToken(user, 'user') }, async (ack) => {
                expect(ack.ok).toBe(true);
                const dbUser = await userModel.findById(user._id);
                expect(dbUser.socketId).toBe(socket.id);
                done();
            });
        });
    });

    it('join sem token é rejeitado e não atualiza socketId nenhum', (done) => {
        connectClient(port()).then((socket) => {
            clientSocket = socket;
            socket.emit('join', { userId: user._id, userType: 'user' }, async (ack) => {
                expect(ack.ok).toBe(false);
                const dbUser = await userModel.findById(user._id);
                expect(dbUser.socketId).toBeFalsy();
                done();
            });
        });
    });

    it('join com userId de outra pessoa e token de quem está conectando ignora o userId do payload — usa a identidade do token', (done) => {
        connectClient(port()).then(async (socket) => {
            clientSocket = socket;
            const victim = await createUser();

            socket.emit('join', { userId: victim._id, userType: 'user', token: generateAuthToken(user, 'user') }, async (ack) => {
                expect(ack.ok).toBe(true);
                const victimAfter = await userModel.findById(victim._id);
                const attackerAfter = await userModel.findById(user._id);
                // A vítima (userId do payload) NÃO recebe o socketId do atacante — quem
                // recebe é o dono real do token.
                expect(victimAfter.socketId).toBeFalsy();
                expect(attackerAfter.socketId).toBe(socket.id);
                done();
            });
        });
    });

    it('update-location-captain sem join autenticado antes é rejeitado', (done) => {
        connectClient(port()).then((socket) => {
            clientSocket = socket;
            socket.on('unauthorized', (payload) => {
                expect(payload.message).toBe('Não autenticado');
                done();
            });
            socket.emit('update-location-captain', {
                userId: captain._id,
                location: { ltd: -23.5, lng: -46.6 }
            });
        });
    });

    it('update-location-captain com join autenticado usa a identidade do token, não o userId do payload', (done) => {
        connectClient(port()).then((socket) => {
            clientSocket = socket;
            const outroMotorista = captain; // usado só como "outro id" no payload

            socket.emit('join', { userId: outroMotorista._id, userType: 'captain', token: generateAuthToken(captain, 'captain') }, async () => {
                const victim = await createCaptain();

                socket.emit('update-location-captain', {
                    userId: victim._id, // tentativa de falsificar a localização de OUTRO motorista
                    location: { ltd: -23.5, lng: -46.6 }
                });

                setTimeout(async () => {
                    const victimAfter = await captainModel.findById(victim._id);
                    const authenticatedAfter = await captainModel.findById(captain._id);
                    expect(victimAfter.location?.ltd).toBeFalsy();
                    expect(authenticatedAfter.location.ltd).toBe(-23.5);
                    done();
                }, 150);
            });
        });
    });
});
