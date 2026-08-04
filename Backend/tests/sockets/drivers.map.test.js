// Fase C da experiência de corrida ativa (2026-08-03): fluxo em tempo real do mapa do
// passageiro. Valida a cadeia completa: passageiro entra na sala 'map-viewers' (com JWT),
// motorista manda localização pelo pipeline que já existia (update-location-captain) e o
// passageiro recebe 'driver-location' quando o motorista está livre — ou 'driver-busy'
// quando ele tem corrida ativa. Escrito com async/await (callbacks `done` quebram no vitest).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const { createServer } = require('http');
const { io: Client } = require('socket.io-client');
const { initializeSocket } = require('../../socket');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');
const { createRide } = require('../factories/ride.factory');
const { generateAuthToken } = require('../setup/authHelper');

const CAPTAIN_POS = { ltd: -23.5505, lng: -46.6333 };

describe('Mapa do passageiro em tempo real (Fase C)', () => {
    let httpServer;
    let port;
    let sockets = [];

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
        sockets.forEach(s => { if (s.connected) s.disconnect(); });
        sockets = [];
    });

    const connect = async () => {
        const socket = Client(`http://localhost:${port}`, { transports: ['websocket'] });
        sockets.push(socket);
        await new Promise((resolve, reject) => {
            socket.on('connect', resolve);
            socket.on('connect_error', reject);
        });
        return socket;
    };

    const connectCaptain = async (captain) => {
        const socket = await connect();
        const ack = await socket.emitWithAck('join', {
            userId: captain._id.toString(),
            userType: 'captain',
            token: generateAuthToken(captain, 'captain')
        });
        expect(ack.ok).toBe(true);
        return socket;
    };

    const waitFor = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

    it('passageiro inscrito recebe driver-location quando um motorista livre atualiza a posição', async () => {
        const user = await createUser();
        const captain = await createCaptain({ isOnline: true });

        const viewerSocket = await connect();
        viewerSocket.emit('subscribe-drivers-map', { token: generateAuthToken(user) });
        // Sem ack no subscribe: espera curta pra sala registrar antes do broadcast.
        await new Promise((resolve) => setTimeout(resolve, 150));

        const captainSocket = await connectCaptain(captain);

        const received = waitFor(viewerSocket, 'driver-location');
        captainSocket.emit('update-location-captain', { location: CAPTAIN_POS });

        const payload = await received;
        expect(payload.driverId).toBe(captain._id.toString());
        expect(payload.vehicleType).toBe('car');
        expect(payload.location).toEqual({ ltd: CAPTAIN_POS.ltd, lng: CAPTAIN_POS.lng });
    });

    it('motorista com corrida ativa vira driver-busy (some do mapa), não driver-location', async () => {
        const user = await createUser();
        const captain = await createCaptain({ isOnline: true });
        await createRide({ user: user._id, captain: captain._id, status: 'started' });

        const viewerSocket = await connect();
        viewerSocket.emit('subscribe-drivers-map', { token: generateAuthToken(user) });
        await new Promise((resolve) => setTimeout(resolve, 150));

        const captainSocket = await connectCaptain(captain);

        let leakedLocation = false;
        viewerSocket.on('driver-location', () => { leakedLocation = true; });
        const busy = waitFor(viewerSocket, 'driver-busy');
        captainSocket.emit('update-location-captain', { location: CAPTAIN_POS });

        const payload = await busy;
        expect(payload.driverId).toBe(captain._id.toString());
        expect(leakedLocation).toBe(false);
    });

    it('subscribe sem token válido não entra na sala (posição de frota é dado sensível)', async () => {
        const captain = await createCaptain({ isOnline: true });

        const intruderSocket = await connect();
        const rejected = waitFor(intruderSocket, 'unauthorized');
        intruderSocket.emit('subscribe-drivers-map', { token: 'token-falso' });
        await rejected;

        const captainSocket = await connectCaptain(captain);

        let leaked = false;
        intruderSocket.on('driver-location', () => { leaked = true; });
        captainSocket.emit('update-location-captain', { location: CAPTAIN_POS });

        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(leaked).toBe(false);
    });
});
