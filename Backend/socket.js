const socketIo = require('socket.io');
const userModel = require('./models/user.model');
const captainModel = require('./models/captain.model');
const rideModel = require('./models/ride.model');
const mapService = require('./services/maps.service');

let io;

function initializeSocket(server) {
    io = socketIo(server, {
        transports: [ 'polling' ],
        cors: {
            origin: '*',
            methods: [ 'GET', 'POST' ]
        }
    });

    io.on('connection', (socket) => {
        console.log(`Client connected: ${socket.id}`);


        socket.on('join', async (data) => {
            const { userId, userType } = data;

            if (userType === 'user') {
                await userModel.findByIdAndUpdate(userId, { socketId: socket.id });
            } else if (userType === 'captain') {
                await captainModel.findByIdAndUpdate(userId, { socketId: socket.id });
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
        });

        socket.on('disconnect', async () => {
            console.log(`Client disconnected: ${socket.id}`);
            await userModel.findOneAndUpdate({ socketId: socket.id }, { socketId: null });
            await captainModel.findOneAndUpdate({ socketId: socket.id }, { socketId: null });
        });
    });
}

const sendMessageToSocketId = (socketId, messageObject) => {

console.log(messageObject);

    if (io) {
        io.to(socketId).emit(messageObject.event, messageObject.data);
    } else {
        console.log('Socket.io not initialized.');
    }
}

module.exports = { initializeSocket, sendMessageToSocketId };