const rideService = require('../services/ride.service');
const { validationResult } = require('express-validator');
const mapService = require('../services/maps.service');
const { sendMessageToSocketId, addSocketToRoom, sendMessageToRoom } = require('../socket');
const rideModel = require('../models/ride.model');
const { getCache, setCache, deleteCache, deleteByPrefix } = require('../cache/cache');
const notificationService = require('../services/notification.service');


module.exports.createRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { userId, pickup, destination, vehicleType, paymentMethod, optionals, observation, useWalletBalance, requestFemaleDriver } = req.body;

    try {
        if (!req.user || !req.user._id) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const ride = await rideService.createRide({ 
            user: req.user._id, 
            pickup, 
            destination, 
            vehicleType,
            paymentMethod,
            optionals,
            observation,
            useWalletBalance,
            requestFemaleDriver
        });

        const pickupCoordinates = await mapService.getAddressCoordinate(pickup);

        const captainsInRadius = await mapService.getCaptainsInTheRadius(pickupCoordinates.ltd, pickupCoordinates.lng, 2);

        // Filter captains by matching vehicle type
        const matchingCaptains = captainsInRadius.filter(captain => {
            if (!captain.vehicle || !captain.vehicle.vehicleType) return false;
            const capType = captain.vehicle.vehicleType;
            return capType === vehicleType || 
                   (vehicleType === 'moto' && capType === 'motorcycle') ||
                   (vehicleType === 'motorcycle' && capType === 'moto');
        });

        const rideWithUser = await rideModel.findOne({ _id: ride._id }).populate('user');

        matchingCaptains.map(captain => {
            // Put captain in a room for this specific ride
            addSocketToRoom(captain.socketId, `ride_${ride._id}`);
            
            sendMessageToSocketId(captain.socketId, {
                event: 'new-ride',
                data: rideWithUser
            });
            notificationService.sendNewRide(captain._id, { rideId: ride._id.toString() });
        });

        // Invalidate dashboard and user history cache
        deleteCache('dashboard:today');
        deleteByPrefix(`history:${req.user._id}`);

        res.status(201).json(ride);

    } catch (err) {

        console.log(err);
        return res.status(500).json({ message: err.message });
    }

};

module.exports.getFare = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { pickup, destination } = req.query;

    try {
        const fare = await rideService.getFare(pickup, destination);
        return res.status(200).json(fare);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.confirmRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.confirmRide({ rideId, captain: req.captain });

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-confirmed',
            data: ride
        })
        notificationService.sendRideAccepted(ride.user._id, { rideId: ride._id.toString() });

        // Delete otp from response sent to captain for security
        const rideForCaptain = ride.toObject();
        delete rideForCaptain.otp;

        // Invalidate dashboard cache
        deleteCache('dashboard:today');

        return res.status(200).json(rideForCaptain);
    } catch (err) {

        console.log(err);
        return res.status(500).json({ message: err.message });
    }
}

module.exports.acceptRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id: rideId } = req.params;

    try {
        const ride = await rideService.acceptRideAtomic({ rideId, captain: req.captain });

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-confirmed',
            data: ride
        });
        
        notificationService.sendRideAccepted(ride.user._id, { rideId: ride._id.toString() });

        // Inform other captains that this ride was taken
        sendMessageToRoom(`ride_${rideId}`, {
            event: 'ride-taken',
            data: { rideId }
        });

        // Delete otp from response sent to captain for security
        const rideForCaptain = ride.toObject();
        delete rideForCaptain.otp;

        // Invalidate dashboard cache
        deleteCache('dashboard:today');

        return res.status(200).json(rideForCaptain);
    } catch (err) {
        console.error(err);
        if (err.message === 'RIDE_ALREADY_ACCEPTED') {
            return res.status(409).json({ message: 'Corrida já aceita por outro motorista' });
        }
        if (err.message === 'RIDE_NOT_FOUND') {
            return res.status(404).json({ message: 'Corrida não encontrada' });
        }
        return res.status(500).json({ message: err.message });
    }
}

module.exports.startRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, otp } = req.query;

    try {
        const ride = await rideService.startRide({ rideId, otp, captain: req.captain });

        console.log(ride);

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-started',
            data: ride
        })
        notificationService.sendRideStarted(ride.user._id, { rideId: ride._id.toString() });

        // Invalidate dashboard cache
        deleteCache('dashboard:today');

        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.updateRideStatus = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId, status } = req.body;

    try {
        const ride = await rideService.updateRideStatus({ rideId, captain: req.captain, status });

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-status-updated',
            data: ride
        })

        // Invalidate dashboard cache
        deleteCache('dashboard:today');

        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.endRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.endRide({ rideId, captain: req.captain });

        sendMessageToSocketId(ride.user.socketId, {
            event: 'ride-ended',
            data: ride
        })
        notificationService.sendRideFinished(ride.user._id, { rideId: ride._id.toString() });

        // Invalidate dashboard and history cache
        deleteCache('dashboard:today');
        if (ride.user) {
            deleteByPrefix(`history:${ride.user._id}`);
        }

        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.payRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.payRide({ rideId, user: req.user });

        // Notify captain that payment was completed
        if (ride.captain?.socketId) {
            sendMessageToSocketId(ride.captain.socketId, {
                event: 'payment-completed',
                data: ride
            });
        }

        // Invalidate dashboard cache
        deleteCache('dashboard:today');

        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.confirmPaymentReceived = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.confirmPaymentReceived({ rideId, captain: req.captain });

        // Notify passenger that payment was confirmed
        if (ride.user?.socketId) {
            sendMessageToSocketId(ride.user.socketId, {
                event: 'payment-confirmed',
                data: ride
            });
        }
        if (ride.user?._id) {
            // Push Notification para o passageiro "Pagamento confirmado"
            notificationService.sendToUser(ride.user._id, 'Pagamento Confirmado', 'Recebemos o seu pagamento, muito obrigado!', 'ADMIN', { rideId: ride._id.toString() }).catch(console.error);
        }

        // Invalidate dashboard and history cache
        deleteCache('dashboard:today');
        if (ride.user) {
            deleteByPrefix(`history:${ride.user._id}`);
        }

        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.getRideHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status || 'all';
        const search = req.query.search || '';

        const cacheKey = `history:${req.user._id}:${page}:${limit}:${status}:${search}`;
        const cached = getCache(cacheKey);

        if (cached) {
            return res.status(200).json(cached);
        }

        const skip = (page - 1) * limit;

        const query = { user: req.user._id };
        if (status !== 'all') {
            if (status === 'completed') {
                query.status = 'finished';
            } else if (status === 'cancelled') {
                query.status = 'cancelled';
            } else if (status === 'ongoing') {
                query.status = { $in: ['pending', 'accepted', 'ongoing'] };
            }
        }

        if (search) {
            query.$or = [
                { pickup: { $regex: search, $options: 'i' } },
                { destination: { $regex: search, $options: 'i' } }
            ];
        }

        const total = await rideModel.countDocuments(query);
        const rides = await rideModel.find(query)
            .populate('captain')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const responseData = {
            rides,
            page,
            limit,
            total,
            hasNext: (skip + limit) < total
        };

        // Cache for 5 minutes
        setCache(cacheKey, responseData, 300);

        return res.status(200).json(responseData);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.getCurrentRide = async (req, res) => {
    try {
        const ride = await rideService.getCurrentRide({ user: req.user._id });
        if (!ride) {
            return res.status(404).json({ message: 'No active ride found' });
        }
        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports.cancelRide = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { rideId } = req.body;

    try {
        const ride = await rideService.cancelRide({ rideId, user: req.user._id });

        // Notify all captains in the room that the ride was cancelled
        sendMessageToRoom(`ride_${ride._id}`, {
            event: 'ride-cancelled',
            data: { rideId: ride._id }
        });

        // Invalidate dashboard and history cache
        deleteCache('dashboard:today');
        deleteByPrefix(`history:${req.user._id}`);

        return res.status(200).json(ride);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}