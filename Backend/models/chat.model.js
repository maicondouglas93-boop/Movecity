const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    // Compat: chats de corrida antigos só tinham rideId. Novos docs preenchem
    // subjectType + subjectId (+ rideId quando subjectType === 'ride').
    subjectType: {
        type: String,
        enum: ['ride', 'parcel'],
        default: 'ride',
        index: true,
    },
    subjectId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    rideId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride',
        sparse: true,
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

chatSchema.index({ subjectType: 1, subjectId: 1 }, { unique: true });
chatSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

module.exports = mongoose.model('chat', chatSchema);
