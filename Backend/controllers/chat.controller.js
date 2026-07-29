const chatService = require('../services/chat.service');
const rideModel = require('../models/ride.model');
const { validationResult } = require('express-validator');

// Rate limiting cache (simple object for demo purposes, use Redis in production)
const rateLimitCache = {};

const checkRateLimit = (userId) => {
    const now = Date.now();
    if (!rateLimitCache[userId]) {
        rateLimitCache[userId] = [];
    }
    // Keep only timestamps from the last second
    rateLimitCache[userId] = rateLimitCache[userId].filter(timestamp => now - timestamp < 1000);
    
    // Max 5 messages per second
    if (rateLimitCache[userId].length >= 5) {
        return false;
    }
    
    rateLimitCache[userId].push(now);
    return true;
};

module.exports.getChat = async (req, res, next) => {
    try {
        const { rideId } = req.params;
        const userOrCaptain = req.user || req.captain;

        const ride = await rideModel.findById(rideId);
        if (!ride) {
            return res.status(404).json({ message: 'Ride not found' });
        }

        // Validate authorization
        if (ride.user.toString() !== userOrCaptain._id.toString() && ride.captain.toString() !== userOrCaptain._id.toString()) {
            return res.status(403).json({ message: 'Unauthorized access to this chat' });
        }

        const chat = await chatService.getOrCreateChat(rideId);
        const messages = await chatService.getChatMessages(chat._id);

        res.status(200).json({ chat, messages });
    } catch (err) {
        console.error('Error fetching chat:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports.sendMessage = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { rideId, message, type } = req.body;
        const userOrCaptain = req.user || req.captain;
        const senderType = req.user ? 'user' : 'captain';

        if (!checkRateLimit(userOrCaptain._id.toString())) {
            return res.status(429).json({ message: 'Too many messages sent. Please slow down.' });
        }

        const ride = await rideModel.findById(rideId);
        if (!ride || !['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'ongoing'].includes(ride.status)) {
            return res.status(400).json({ message: 'Cannot send message. Ride is not active.' });
        }

        // Sanitize basic XSS manually for the demo
        const sanitizedMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Profanity filter logic (mocked)
        const badWords = ['palavrao1', 'palavrao2'];
        const isProfane = badWords.some(word => sanitizedMessage.toLowerCase().includes(word));
        if (isProfane) {
            return res.status(400).json({ message: 'Message contains prohibited content.' });
        }

        const chat = await chatService.getOrCreateChat(rideId);

        const newMessage = await chatService.saveMessage({
            chatId: chat._id,
            rideId,
            senderId: userOrCaptain._id,
            senderType,
            message: sanitizedMessage,
            type
        });

        res.status(201).json(newMessage);
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports.markRead = async (req, res, next) => {
    try {
        const { rideId } = req.body;
        const userOrCaptain = req.user || req.captain;
        const readerType = req.user ? 'user' : 'captain';

        const chat = await chatService.getOrCreateChat(rideId);
        await chatService.markAsRead(chat._id, readerType);

        res.status(200).json({ message: 'Messages marked as read' });
    } catch (err) {
        console.error('Error marking messages as read:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
};
