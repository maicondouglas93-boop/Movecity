const { createServer } = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { initializeSocket } = require('../../socket');
const userModel = require('../../models/user.model');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');

describe('Socket.IO Integration Tests', () => {
    let io, serverSocket, clientSocket;
    let httpServer;
    let user;
    
    beforeAll((done) => {
        httpServer = createServer();
        // initializeSocket expects an httpServer
        initializeSocket(httpServer);
        
        httpServer.listen(() => {
            const port = httpServer.address().port;
            clientSocket = new Client(`http://localhost:${port}`);
            clientSocket.on('connect', done);
        });
    });

    afterAll((done) => {
        clientSocket.close();
        setTimeout(() => {
            io && io.close();
            httpServer.close();
            done();
        }, 200);
    });

    beforeEach(async () => {
        user = await createUser();
    });

    it('should allow a user to join and update their socketId', (done) => {
        clientSocket.emit('join', { userId: user._id, userType: 'user' });
        
        setTimeout(async () => {
            const dbUser = await userModel.findById(user._id);
            expect(dbUser.socketId).toBe(clientSocket.id);
            done();
        }, 100);
    });
});
