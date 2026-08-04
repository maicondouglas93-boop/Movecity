// Fase A da experiência de corrida ativa (2026-08-03).
//
// A sala `ride_<id>` é populada por socketId no momento do despacho/aceite. Antes da
// correção em socket.js, qualquer reconexão gerava um socketId novo que não estava na
// sala — o motorista designado parava de receber 'ride-cancelled' e afins. Este teste
// simula exatamente queda + reconexão e verifica que o join autenticado reentra na sala.
//
// Escrito com async/await (não callbacks `done`) de propósito: as suítes de socket
// antigas usam `done` e o vitest as rejeita com FixtureParseError.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const { createServer } = require('http');
const { io: Client } = require('socket.io-client');
const { initializeSocket, sendMessageToRoom } = require('../../socket');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const { generateAuthToken } = require('../setup/authHelper');

describe('Reentrada na sala ride_<id> após reconexão (Fase A)', () => {
    let httpServer;
    let port;
    let client;

    beforeAll(async () => {
        httpServer = createServer();
        initializeSocket(httpServer);
        await new Promise((resolve) => httpServer.listen(0, resolve));
        port = httpServer.address().port;
    });

    afterAll(async () => {
        await new Promise((resolve) => httpServer.close(resolve));
    });

    afterEach(() => {
        if (client && client.connected) client.disconnect();
        client = null;
    });

    const connectAndJoin = async (captain, token) => {
        const socket = Client(`http://localhost:${port}`, { transports: ['websocket'] });
        await new Promise((resolve, reject) => {
            socket.on('connect', resolve);
            socket.on('connect_error', reject);
        });
        const ack = await socket.emitWithAck('join', {
            userId: captain._id.toString(),
            userType: 'captain',
            token
        });
        expect(ack.ok).toBe(true);
        return socket;
    };

    it('motorista com corrida ativa volta a receber eventos da sala depois de cair e reconectar', async () => {
        const captain = await createCaptain();
        const ride = await createRide({ captain: captain._id, status: 'accepted' });
        const token = generateAuthToken(captain, 'captain');

        // Primeira conexão (a que teria entrado na sala no aceite) cai.
        const firstSocket = await connectAndJoin(captain, token);
        firstSocket.disconnect();

        // Reconexão: socketId novo, que nunca esteve na sala.
        client = await connectAndJoin(captain, token);

        const received = new Promise((resolve) => client.on('ride-cancelled', resolve));
        sendMessageToRoom(`ride_${ride._id}`, {
            event: 'ride-cancelled',
            data: { rideId: ride._id.toString() }
        });

        const payload = await received;
        expect(payload.rideId).toBe(ride._id.toString());
    });

    it('motorista SEM corrida ativa não entra em sala de corrida nenhuma', async () => {
        const captain = await createCaptain();
        const otherRide = await createRide({ status: 'accepted' }); // corrida de outro motorista
        const token = generateAuthToken(captain, 'captain');

        client = await connectAndJoin(captain, token);

        let leaked = false;
        client.on('ride-cancelled', () => { leaked = true; });
        sendMessageToRoom(`ride_${otherRide._id}`, {
            event: 'ride-cancelled',
            data: { rideId: otherRide._id.toString() }
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(leaked).toBe(false);
    });
});
