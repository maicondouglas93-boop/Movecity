const mongoose = require('mongoose');

const notificationTokenSchema = new mongoose.Schema({
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
    device: {
        type: String,
        default: 'web'
    },
    token: {
        type: String,
        required: true,
        unique: true
    }
}, { timestamps: true });

const NotificationToken = mongoose.model('NotificationToken', notificationTokenSchema);

module.exports = NotificationToken;
