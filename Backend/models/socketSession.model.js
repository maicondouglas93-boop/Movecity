'use strict';

const mongoose = require('mongoose');

const socketSessionSchema = new mongoose.Schema({
    actorType: {
        type: String,
        required: true,
        enum: ['user', 'captain', 'admin'],
    },
    actorId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    jti: {
        type: String,
        required: true,
        maxlength: 200,
    },
    deviceIdHash: {
        type: String,
        required: true,
        maxlength: 64,
    },
    instanceId: {
        type: String,
        required: true,
        maxlength: 200,
    },
    socketId: {
        type: String,
        required: true,
        unique: true,
    },
    tokenExpiresAt: {
        type: Date,
        required: true,
    },
    connectedAt: {
        type: Date,
        default: Date.now,
    },
    lastValidatedAt: {
        type: Date,
        default: Date.now,
    },
    disconnectedAt: {
        type: Date,
        default: null,
    },
    disconnectReason: {
        type: String,
        default: '',
        maxlength: 100,
    },
    purgeAt: {
        type: Date,
        required: true,
    },
}, { timestamps: true });

socketSessionSchema.index({ actorType: 1, actorId: 1, disconnectedAt: 1 });
socketSessionSchema.index({ actorType: 1, actorId: 1, jti: 1, disconnectedAt: 1 });
socketSessionSchema.index({ instanceId: 1, disconnectedAt: 1 });
socketSessionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SocketSession', socketSessionSchema);
