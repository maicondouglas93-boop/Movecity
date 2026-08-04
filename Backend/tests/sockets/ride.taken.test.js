// Correção crítica do aceite (2026-08-03): a sala ride_<id> contém TODOS os candidatos
// do despacho — inclusive quem venceu o aceite atômico. O evento 'ride-taken' precisa
// dizer QUEM venceu (captainId) para o frontend do vencedor não tratar a própria
// vitória como "corrida aceita por outro motorista". Este teste percorre o caminho
// real: HTTP POST /rides/:id/accept (o mesmo endpoint do app e do Service Worker) e a
// emissão de verdade via Socket.IO para um socket na sala.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const { createServer } = require('http');
const request = require('supertest');
const { io: Client } = require('socket.io-client');
const app = require('../../app');
const { initializeSocket, addSocketToRoom } = require('../../socket');
const { createCaptain } = require('../factories/captain.factory');
const { createUser } = require('../factories/user.factory');
const { createRide } = require('../factories/ride.factory');
const { generateAuthToken } = require('../setup/authHelper');
const userModel = require('../../models/user.model');

describe('ride-taken identifica o motorista vencedor (correção do aceite)', () => {
    let httpServer;
    let sockets = [];

    beforeAll(async () => {
        httpServer = createServer();
        initializeSocket(httpServer);
        await new Promise((resolve) => httpServer.listen(0, resolve));
    });

    afterAll(async () => {
        await new Promise((resolve) => httpServer.close(resolve));
    });

    afterEach(() => {
        sockets.forEach(s => { if (s.connected) s.disconnect(); });
        sockets = [];
    });

    const connect = async () => {
        const port = httpServer.address().port;
        const socket = Client(`http://localhost:${port}`, { transports: ['websocket'] });
        sockets.push(socket);
        await new Promise((resolve, reject) => {
            socket.on('connect', resolve);
            socket.on('connect_error', reject);
        });
        return socket;
    };

    it('emite ride-taken com o captainId do vencedor para a sala da corrida', async () => {
        const user = await createUser();
        // socketId inexistente mas definido — o controller emite 'ride-confirmed' para
        // ele; sem ninguém escutando, o emit vai para o vazio, como num app fechado.
        await userModel.findByIdAndUpdate(user._id, { socketId: 'socket-passageiro-offline' });

        const winner = await createCaptain({ isOnline: true });
        const ride = await createRide({ user: user._id, captain: undefined, status: 'requested' });

        // Um motorista PERDEDOR que recebeu a oferta no despacho e está na sala.
        const loserSocket = await connect();
        addSocketToRoom(loserSocket.id, `ride_${ride._id}`);

        const taken = new Promise((resolve) => loserSocket.once('ride-taken', resolve));

        const response = await request(app)
            .post(`/rides/${ride._id}/accept`)
            .set('Authorization', `Bearer ${generateAuthToken(winner, 'captain')}`);

        expect(response.statusCode).toBe(200);

        const payload = await taken;
        expect(payload.rideId).toBe(ride._id.toString());
        // É este campo que permite ao vencedor ignorar o evento em vez de mostrar
        // "aceita por outro motorista" para si mesmo.
        expect(payload.captainId).toBe(winner._id.toString());
    });
});
