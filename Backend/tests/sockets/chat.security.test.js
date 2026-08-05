const { createServer } = require('http');
const Client = require('socket.io-client');
const { initializeSocket, publishPersistedChatMessage } = require('../../socket');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const Notification = require('../../models/notification.model');

const waitFor = async (queryFn, { attempts = 30, delayMs = 100 } = {}) => {
    for (let i = 0; i < attempts; i++) {
        const found = await queryFn();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
};

// A10 da auditoria de push (2026-08-02): antes, qualquer socket conectado entrava em
// `chat_<rideId>` só sabendo o id da corrida — sem provar quem era. Este teste confirma,
// com clientes de socket reais (não mocks) contra o servidor de socket real, que um
// estranho à corrida não consegue nem entrar na sala nem receber as mensagens trocadas
// nela, enquanto o passageiro e o motorista reais da corrida conseguem.
describe('Segurança do chat via Socket.IO (A10)', () => {
    let httpServer;
    let port;

    beforeAll((done) => {
        httpServer = createServer();
        initializeSocket(httpServer);
        httpServer.listen(() => {
            port = httpServer.address().port;
            done();
        });
    });

    afterAll((done) => {
        httpServer.close(done);
    });

    const connectClient = () => new Promise((resolve) => {
        const client = new Client(`http://localhost:${port}`);
        client.on('connect', () => resolve(client));
    });

    it('estranho à corrida não consegue entrar na sala nem receber mensagens', async () => {
        const passenger = await createUser();
        const captain = await createCaptain();
        const stranger = await createCaptain();
        const ride = await createRide({ user: passenger._id, captain: captain._id, status: 'accepted' });

        const passengerToken = generateAuthToken(passenger, 'user');
        const strangerToken = generateAuthToken(stranger, 'captain');

        const passengerSocket = await connectClient();
        const strangerSocket = await connectClient();

        const strangerUnauthorized = new Promise((resolve) => {
            strangerSocket.on('unauthorized', resolve);
        });

        // O estranho tenta entrar com um JWT real e válido — só que de uma identidade
        // que não é nem o passageiro nem o motorista desta corrida.
        strangerSocket.emit('join-chat', { rideId: ride._id.toString(), token: strangerToken });
        const unauthorizedEvent = await strangerUnauthorized;
        expect(unauthorizedEvent).toEqual({ message: 'Sem acesso a este chat' });

        // O passageiro de verdade entra normalmente.
        passengerSocket.emit('join-chat', { rideId: ride._id.toString(), token: passengerToken });
        await new Promise((resolve) => setTimeout(resolve, 150));

        const strangerReceivedMessage = new Promise((resolve) => {
            strangerSocket.on('receive-message', () => resolve(true));
            setTimeout(() => resolve(false), 300);
        });

        // O passageiro manda uma mensagem pra sala.
        await publishPersistedChatMessage({
            subject: {
                subjectType: 'ride',
                subjectId: ride._id,
                userId: passenger._id,
                captainId: captain._id,
            },
            senderType: 'user',
            message: { _id: 'm1', message: 'oi' },
        });

        const strangerGotIt = await strangerReceivedMessage;
        expect(strangerGotIt).toBe(false);

        passengerSocket.close();
        strangerSocket.close();
    });

    it('passageiro e motorista reais da corrida trocam mensagem normalmente', async () => {
        const passenger = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: passenger._id, captain: captain._id, status: 'accepted' });

        const passengerToken = generateAuthToken(passenger, 'user');
        const captainToken = generateAuthToken(captain, 'captain');

        const passengerSocket = await connectClient();
        const captainSocket = await connectClient();

        passengerSocket.emit('join-chat', { rideId: ride._id.toString(), token: passengerToken });
        captainSocket.emit('join-chat', { rideId: ride._id.toString(), token: captainToken });
        await new Promise((resolve) => setTimeout(resolve, 150));

        const captainReceived = new Promise((resolve) => {
            captainSocket.on('receive-message', resolve);
        });

        await publishPersistedChatMessage({
            subject: {
                subjectType: 'ride',
                subjectId: ride._id,
                userId: passenger._id,
                captainId: captain._id,
            },
            senderType: 'user',
            message: { _id: 'm2', message: 'chegando' },
        });

        const received = await captainReceived;
        expect(received).toEqual({ _id: 'm2', message: 'chegando' });

        // A7: os dois estão com o chat aberto agora — o Socket.IO já entrega em tempo
        // real, então não faz sentido (nem deveria) mandar push também.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await Notification.findOne({ captainId: captain._id, type: 'CHAT' })).toBeFalsy();

        passengerSocket.close();
        captainSocket.close();
    });

    it('rejeita join-chat sem token', async () => {
        const passenger = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: passenger._id, captain: captain._id, status: 'accepted' });

        const socket = await connectClient();
        const unauthorized = new Promise((resolve) => socket.on('unauthorized', resolve));

        socket.emit('join-chat', { rideId: ride._id.toString() });
        const event = await unauthorized;
        expect(event.message).toBe('Sem acesso a este chat');

        socket.close();
    });
});

// A7 da auditoria de push (2026-08-02): "App aberto -> Socket.IO; App fechado ->
// Firebase Push". Antes, uma mensagem de chat só era entregue a quem estivesse com o
// chat aberto naquele instante — quem não estava simplesmente nunca sabia da mensagem.
describe('Push de chat quando o destinatário não está presente (Fase 5, A7)', () => {
    let httpServer;
    let port;

    beforeAll((done) => {
        httpServer = createServer();
        initializeSocket(httpServer);
        httpServer.listen(() => {
            port = httpServer.address().port;
            done();
        });
    });

    afterAll((done) => {
        httpServer.close(done);
    });

    const connectClient = () => new Promise((resolve) => {
        const client = new Client(`http://localhost:${port}`);
        client.on('connect', () => resolve(client));
    });

    it('motorista manda mensagem com o passageiro sem o chat aberto -> passageiro recebe push', async () => {
        const passenger = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: passenger._id, captain: captain._id, status: 'accepted' });
        const captainToken = generateAuthToken(captain, 'captain');

        const NotificationToken = require('../../models/notificationToken.model');
        await NotificationToken.create({ userId: passenger._id, token: 'tok-a7-passenger', device: 'test' });

        const captainSocket = await connectClient();
        captainSocket.emit('join-chat', { rideId: ride._id.toString(), token: captainToken });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // O passageiro nunca entrou na sala — chat fechado/app em segundo plano.
        await publishPersistedChatMessage({
            subject: {
                subjectType: 'ride',
                subjectId: ride._id,
                userId: passenger._id,
                captainId: captain._id,
            },
            senderType: 'captain',
            message: { _id: 'm3', message: 'Estou chegando' },
        });

        const notification = await waitFor(() => Notification.findOne({ userId: passenger._id, type: 'CHAT' }));
        expect(notification).toBeTruthy();
        expect(notification.message).toBe('Estou chegando');

        captainSocket.close();
    });

    it('passageiro sai do chat (leave-chat) e volta a ficar "ausente" -> mensagem seguinte gera push', async () => {
        const passenger = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({ user: passenger._id, captain: captain._id, status: 'accepted' });
        const passengerToken = generateAuthToken(passenger, 'user');
        const captainToken = generateAuthToken(captain, 'captain');

        const NotificationToken = require('../../models/notificationToken.model');
        await NotificationToken.create({ userId: passenger._id, token: 'tok-a7-leave', device: 'test' });

        const passengerSocket = await connectClient();
        const captainSocket = await connectClient();

        passengerSocket.emit('join-chat', { rideId: ride._id.toString(), token: passengerToken });
        captainSocket.emit('join-chat', { rideId: ride._id.toString(), token: captainToken });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Passageiro fecha o chat — presença precisa cair, senão a próxima mensagem
        // nunca geraria push (achando, por engano, que ele ainda está olhando a tela).
        passengerSocket.emit('leave-chat', { rideId: ride._id.toString() });
        await new Promise((resolve) => setTimeout(resolve, 100));

        await publishPersistedChatMessage({
            subject: {
                subjectType: 'ride',
                subjectId: ride._id,
                userId: passenger._id,
                captainId: captain._id,
            },
            senderType: 'captain',
            message: { _id: 'm4', message: 'Cheguei no local' },
        });

        const notification = await waitFor(() => Notification.findOne({ userId: passenger._id, type: 'CHAT' }));
        expect(notification).toBeTruthy();

        passengerSocket.close();
        captainSocket.close();
    });
});
