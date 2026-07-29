const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    chatId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'chat',
        required: true
    },
    rideId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride',
        required: true
    },
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'senderType'
    },
    senderType: {
        type: String,
        enum: ['user', 'captain'],
        required: true
    },
    type: {
        type: String,
        enum: ['text', 'image', 'location', 'audio'],
        default: 'text'
    },
    message: {
        type: String,
        required: true,
        maxlength: [500, 'Message cannot exceed 500 characters']
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent'
    }
}, { timestamps: true });

// Index for fast retrieval of messages per chat
messageSchema.index({ chatId: 1, createdAt: 1 });
// Expiration index to clean up messages after 180 days
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

module.exports = mongoose.model('message', messageSchema);
