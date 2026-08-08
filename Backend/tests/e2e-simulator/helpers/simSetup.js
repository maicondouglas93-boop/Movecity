// Infraestrutura real de servidor HTTP + Socket.IO para os cenários do simulador —
// mesmo padrão de tests/sockets/ride.taken.test.js (createServer + initializeSocket +
// socket.io-client real + supertest). Nada aqui é mock: é o app real (../../../app)
// e o socket real (../../../socket) rodando sobre uma porta efêmera local.
const { createServer } = require('http');
const request = require('supertest');
const { io: Client } = require('socket.io-client');
const app = require('../../../app');
const { initializeSocket } = require('../../../socket');
const { generateAuthToken } = require('../../setup/authHelper');

async function startSimServer() {
    const httpServer = createServer();
    initializeSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    const port = httpServer.address().port;
    const sockets = [];

    const connectSocket = async () => {
        const socket = Client(`http://localhost:${port}`, { transports: ['websocket'] });
        sockets.push(socket);
        await new Promise((resolve, reject) => {
            socket.on('connect', resolve);
            socket.on('connect_error', reject);
        });
        return socket;
    };

    // Espelha o handler real 'join' do socket.js: {userId, userType, token} + ack.
    const joinSocket = (socket, { userId, userType, token }) => new Promise((resolve, reject) => {
        socket.emit('join', { userId, userType, token }, (ack) => {
            if (ack && ack.ok) resolve(ack);
            else reject(new Error(`join recusado pelo servidor: ${ack?.message || 'sem resposta'}`));
        });
    });

    const stop = async () => {
        sockets.forEach((s) => { if (s.connected) s.disconnect(); });
        await new Promise((resolve) => httpServer.close(resolve));
    };

    return { app, request, httpServer, port, connectSocket, joinSocket, sockets, stop };
}

module.exports = { startSimServer, generateAuthToken };
