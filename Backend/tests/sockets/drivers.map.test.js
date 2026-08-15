// Fluxo em tempo real do mapa pré-corrida: cada passageiro usa uma assinatura curta
// vinculada ao próprio centro/raio e recebe ids efêmeros e coordenadas aproximadas.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const { createServer } = require('http');
const { io: Client } = require('socket.io-client');
const { initializeSocket, emitDriverMapUpdate } = require('../../socket');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');
const { generateAuthToken } = require('../setup/authHelper');
const {
    createPublicMapSubscription,
    publicDriverId,
    toPublicLocation,
} = require('../../utils/publicDriverMap');

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

    const subscribeViewer = async (socket, user, center = { lat: CAPTAIN_POS.ltd, lng: CAPTAIN_POS.lng }) => {
        const subscription = createPublicMapSubscription({ userId: user._id, center });
        const ack = await socket.emitWithAck('subscribe-drivers-map', {
            subscriptionToken: subscription.token,
        });
        expect(ack.ok).toBe(true);
        return subscription;
    };

    it('passageiro inscrito recebe driver-location quando um motorista livre atualiza a posição', async () => {
        const user = await createUser();
        const captain = await createCaptain({ isOnline: true });

        const viewerSocket = await connect();
        const subscription = await subscribeViewer(viewerSocket, user);

        const captainSocket = await connectCaptain(captain);

        const received = waitFor(viewerSocket, 'driver-location');
        captainSocket.emit('update-location-captain', { location: CAPTAIN_POS });

        const payload = await received;
        expect(payload.driverId).toBe(publicDriverId(captain._id, subscription.nonce));
        expect(payload.vehicleType).toBe('car');
        expect(payload.location).toEqual(toPublicLocation(CAPTAIN_POS));
    });

    it('motorista visível que fica ocupado some com id efêmero, sem nova localização', async () => {
        const user = await createUser();
        const captain = await createCaptain({ isOnline: true });

        const viewerSocket = await connect();
        const subscription = await subscribeViewer(viewerSocket, user);
        const becameVisible = waitFor(viewerSocket, 'driver-location');
        emitDriverMapUpdate(captain._id, { busy: false, vehicleType: 'car', location: CAPTAIN_POS });
        await becameVisible;

        let leakedLocation = false;
        viewerSocket.on('driver-location', () => { leakedLocation = true; });
        const busy = waitFor(viewerSocket, 'driver-busy');
        emitDriverMapUpdate(captain._id, { busy: true });

        const payload = await busy;
        expect(payload.driverId).toBe(publicDriverId(captain._id, subscription.nonce));
        expect(leakedLocation).toBe(false);
    });

    it('não repete driver-busy a cada posição do motorista em corrida', async () => {
        const user = await createUser();
        const captain = await createCaptain({ isOnline: true });

        const viewerSocket = await connect();
        await subscribeViewer(viewerSocket, user);
        const becameVisible = waitFor(viewerSocket, 'driver-location');
        emitDriverMapUpdate(captain._id, { busy: false, vehicleType: 'car', location: CAPTAIN_POS });
        await becameVisible;

        let busyCount = 0;
        viewerSocket.on('driver-busy', () => { busyCount += 1; });

        // Em corrida a posição chega a cada ~5s; o passageiro já removeu o marcador na
        // primeira. Repetir só gastaria banda de todo mundo com o mapa aberto.
        emitDriverMapUpdate(captain._id, { busy: true });
        await new Promise((resolve) => setTimeout(resolve, 250));
        emitDriverMapUpdate(captain._id, { busy: true });
        await new Promise((resolve) => setTimeout(resolve, 250));

        expect(busyCount).toBe(1);
    });

    it('motorista liberado da corrida reaparece no mapa imediatamente, sem esperar o throttle', async () => {
        const user = await createUser();
        const captain = await createCaptain({ isOnline: true });

        const viewerSocket = await connect();
        const subscription = await subscribeViewer(viewerSocket, user);

        const driverId = captain._id.toString();
        emitDriverMapUpdate(driverId, { busy: true });

        // Caminho do fim de corrida (endRide/cancelRideByCaptain): voltar de ocupado para
        // disponível é mudança de estado e passa na frente da janela de throttle.
        const received = waitFor(viewerSocket, 'driver-location');
        emitDriverMapUpdate(driverId, { busy: false, vehicleType: 'car', location: CAPTAIN_POS });

        const payload = await received;
        expect(payload.driverId).toBe(publicDriverId(driverId, subscription.nonce));
        expect(payload.location).toEqual(toPublicLocation(CAPTAIN_POS));
    });

    it('passageiro fora do raio não recebe movimento de outra cidade', async () => {
        const nearUser = await createUser();
        const farUser = await createUser();
        const captain = await createCaptain({ isOnline: true });
        const nearSocket = await connect();
        const farSocket = await connect();
        await subscribeViewer(nearSocket, nearUser);
        await subscribeViewer(farSocket, farUser, { lat: -22.9068, lng: -43.1729 });

        let leakedToFarViewer = false;
        farSocket.on('driver-location', () => { leakedToFarViewer = true; });
        const receivedNear = waitFor(nearSocket, 'driver-location');
        emitDriverMapUpdate(captain._id, { busy: false, vehicleType: 'car', location: CAPTAIN_POS });

        await receivedNear;
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(leakedToFarViewer).toBe(false);
    });

    it('subscribe sem assinatura válida não recebe posição de frota', async () => {
        const captain = await createCaptain({ isOnline: true });

        const intruderSocket = await connect();
        const rejected = waitFor(intruderSocket, 'unauthorized');
        intruderSocket.emit('subscribe-drivers-map', { subscriptionToken: 'token-falso' });
        await rejected;

        const captainSocket = await connectCaptain(captain);

        let leaked = false;
        intruderSocket.on('driver-location', () => { leaked = true; });
        captainSocket.emit('update-location-captain', { location: CAPTAIN_POS });

        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(leaked).toBe(false);
    });
});
