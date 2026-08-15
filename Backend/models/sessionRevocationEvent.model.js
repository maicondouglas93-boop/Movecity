'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');

const sessionRevocationEventSchema = new mongoose.Schema({
    eventId: {
        type: String,
        required: true,
        unique: true,
        default: () => crypto.randomUUID(),
    },
    scope: {
        type: String,
        required: true,
        enum: ['account', 'session'],
    },
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
        default: null,
        maxlength: 200,
    },
    reason: {
        type: String,
        required: true,
        maxlength: 100,
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
    purgeAt: {
        type: Date,
        default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
}, { versionKey: false });

sessionRevocationEventSchema.pre('validate', function validateScope(next) {
    if (this.scope === 'session' && !this.jti) {
        return next(new Error('Revogação de sessão exige jti.'));
    }
    return next();
});

sessionRevocationEventSchema.index({ actorType: 1, actorId: 1, createdAt: -1 });
sessionRevocationEventSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SessionRevocationEvent', sessionRevocationEventSchema);
