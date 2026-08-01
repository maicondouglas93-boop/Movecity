const socketIo = require('socket.io');
const userModel = require('./models/user.model');
const captainModel = require('./models/captain.model');
const rideModel = require('./models/ride.model');
const mapService = require('./services/maps.service');

let io;

function initializeSocket(server) {
    const allowedOrigins = [
        "http://localhost:5173",
        process.env.FRONTEND_URL
    ];

    io = socketIo(server, {
        transports: [ 'websocket', 'polling' ],
        cors: {
            origin: allowedOrigins,
            methods: [ 'GET', 'POST' ],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        console.log(`[AUDIT] Client connected: ${socket.id}`);

        socket.on('join', async (data) => {
            const { userId, userType } = data;
            console.log(`[AUDIT] User ${userId} (${userType}) solicitou JOIN no socket ${socket.id}`);

            if (userType === 'user') {
                await userModel.findByIdAndUpdate(userId, { socketId: socket.id });
                console.log(`[AUDIT] User ${userId} atualizou socketId para ${socket.id}`);
            } else if (userType === 'captain') {
                await captainModel.findByIdAndUpdate(userId, { socketId: socket.id });
                console.log(`[AUDIT] Captain ${userId} atualizou socketId para ${socket.id}`);
            } else if (userType === 'admin') {
                socket.join('admin_room');
            }
        });


        socket.on('update-location-captain', async (data) => {
            const { userId, location } = data;

            if (!location || location.ltd == null || location.lng == null) {
                return socket.emit('error', { message: 'Invalid location data' });
            }

            await captainModel.findByIdAndUpdate(userId, {
                location: {
                    ltd: location.ltd,
                    lng: location.lng
                },
                locationGeoJSON: {
                    type: 'Point',
                    coordinates: [location.lng, location.ltd]
                }
            });

            // Find active ride for this captain and emit update to the rider
            const ride = await rideModel.findOne({
                captain: userId,
                status: { $in: [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'ongoing' ] }
            }).populate('user');

            if (ride) {
                let currentDistance = ride.actualDistance || 0;
                
                if (ride.status === 'started' || ride.status === 'ongoing') {
                    if (ride.lastLocation && ride.lastLocation.lat && ride.lastLocation.lng) {
                        const distKm = mapService.haversineKm(ride.lastLocation.lat, ride.lastLocation.lng, location.ltd, location.lng);
                        const distMeters = distKm * 1000;
                        
                        // Filtro de Precisão (GPS accuracy filter)
                        // Ignore jumps > 2000m (2km) - likely a glitch
                        // Ignore jumps < 5m - likely standing still and GPS drifting
                        if (distMeters > 5 && distMeters < 2000) {
                            currentDistance += distMeters;
                            // Update distance and location only when valid movement occurred
                            await rideModel.findByIdAndUpdate(ride._id, {
                                actualDistance: currentDistance,
                                lastLocation: { lat: location.ltd, lng: location.lng }
                            });
                        }
                    } else {
                        // First time saving location after ride started
                        await rideModel.findByIdAndUpdate(ride._id, {
                            lastLocation: { lat: location.ltd, lng: location.lng }
                        });
                    }
                }

                if (ride.user && ride.user.socketId) {
                    io.to(ride.user.socketId).emit('captain-location-updated', {
                        ltd: location.ltd,
                        lng: location.lng,
                        actualDistance: currentDistance
                    });
                }
                // Also send back to the captain's socket to update their local map in real time
                socket.emit('captain-location-updated', {
                    ltd: location.ltd,
                    lng: location.lng,
                    actualDistance: currentDistance
                });
            }

            io.to('admin_room').emit('admin-captain-location-updated', {
                captainId: userId,
                ltd: location.ltd,
                lng: location.lng,
            });
        });

        // Chat events
        socket.on('join-chat', (data) => {
            const { rideId } = data;
            if (rideId) {
                socket.join(`chat_${rideId}`);
            }
        });

        socket.on('leave-chat', (data) => {
            const { rideId } = data;
            if (rideId) {
                socket.leave(`chat_${rideId}`);
            }
        });

        socket.on('send-message', (data) => {
            const { rideId, message } = data;
            if (rideId) {
                socket.to(`chat_${rideId}`).emit('receive-message', message);
            }
        });

        socket.on('message-delivered', (data) => {
            const { rideId, messageId } = data;
            if (rideId) {
                socket.to(`chat_${rideId}`).emit('message-delivered', { messageId });
            }
        });

        socket.on('message-read', (data) => {
            const { rideId, messageId } = data;
            if (rideId) {
                socket.to(`chat_${rideId}`).emit('message-read', { messageId });
            }
        });

        socket.on('typing-start', (data) => {
            const { rideId, senderType } = data;
            if (rideId) {
                socket.to(`chat_${rideId}`).emit('typing-start', { senderType });
            }
        });

        socket.on('typing-stop', (data) => {
            const { rideId, senderType } = data;
            if (rideId) {
                socket.to(`chat_${rideId}`).emit('typing-stop', { senderType });
            }
        });

        socket.on('disconnect', async () => {
            console.log(`[AUDIT] Client disconnected: ${socket.id}`);
            await userModel.findOneAndUpdate({ socketId: socket.id }, { socketId: null });

            // findOneAndUpdate sem { new: true } retorna o documento ANTES do update,
            // então dá pra saber se esse motorista estava online quando desconectou.
            const captainBeforeUpdate = await captainModel.findOneAndUpdate({ socketId: socket.id }, { socketId: null });
            if (captainBeforeUpdate && captainBeforeUpdate.isOnline) {
                // Motorista fechou o app/perdeu conexão sem tocar em "Ficar Offline" —
                // sem isto, o tempo online contaria para sempre e ele continuaria
                // aparecendo como candidato a corridas com isOnline:true.
                const captainService = require('./services/captain.service');
                await captainService.endOnlineSession(captainBeforeUpdate._id);
                await captainModel.findByIdAndUpdate(captainBeforeUpdate._id, { isOnline: false, status: 'inactive' });

                const { deleteByPrefix } = require('./cache/cache');
                deleteByPrefix(`profile:captain:${captainBeforeUpdate._id}`);
                deleteByPrefix('drivers:');
            }
        });
    });
}

const sendMessageToSocketId = (socketId, messageObject) => {
    console.log(`[AUDIT] Socket emit '${messageObject.event}' para socketId: ${socketId}`);

    if (io) {
        io.to(socketId).emit(messageObject.event, messageObject.data);
    } else {
        console.log('[AUDIT] ERROR: Socket.io not initialized.');
    }
}

const addSocketToRoom = (socketId, roomName) => {
    console.log(`[AUDIT] Adicionando socketId ${socketId} à sala ${roomName}`);
    if (io) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            socket.join(roomName);
            console.log(`[AUDIT] socketId ${socketId} entrou na sala ${roomName} com sucesso`);
        } else {
            console.log(`[AUDIT] ERROR: Socket ${socketId} não encontrado no momento do JOIN na sala ${roomName}`);
        }
    }
}

const sendMessageToRoom = (roomName, messageObject) => {
    if (io) {
        io.to(roomName).emit(messageObject.event, messageObject.data);
    } else {
        console.log('Socket.io not initialized.');
    }
}

// P3.2 da auditoria de concorrência (2026-08-02): usado no bloqueio administrativo de
// usuário/motorista — sem derrubar o socket ativo, a pessoa bloqueada continua recebendo
// eventos em tempo real (inclusive novas corridas, se for motorista) até fechar o app
// sozinha, mesmo com o token já rejeitado nas próximas chamadas HTTP.
const disconnectSocket = (socketId) => {
    if (!io || !socketId) return;
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
        console.log(`[AUDIT] Desconectando socketId ${socketId} (bloqueio administrativo)`);
        socket.disconnect(true);
    }
}

module.exports = { initializeSocket, sendMessageToSocketId, addSocketToRoom, sendMessageToRoom, disconnectSocket };