const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    rideId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride',
        required: true,
        unique: true // One chat per ride
    },
    passengerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    captainId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
        required: true
    },
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'message',
        default: null
    },
    unreadUser: {
        type: Number,
        default: 0
    },
    unreadCaptain: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// Expiration index to clean up chat documents after 180 days
chatSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

module.exports = mongoose.model('chat', chatSchema);
