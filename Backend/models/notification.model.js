const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: false
    },
    captainId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'captain',
        required: false
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    message: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['NEW_RIDE', 'RIDE_ACCEPTED', 'RIDE_STARTED', 'RIDE_FINISHED', 'PROMOTION', 'ADMIN', 'RECHARGE'],
        default: 'NEW_RIDE'
    },
    targetAudience: {
        type: String,
        enum: ['all', 'passengers', 'drivers', 'specific'],
        default: 'specific'
    },
    status: {
        type: String,
        enum: ['draft', 'sent', 'failed'],
        default: 'draft'
    },
    read: {
        type: Boolean,
        default: false
    },
    sentAt: {
        type: Date
    }
}, { timestamps: true });

module.exports = mongoose.model('notification', notificationSchema);
