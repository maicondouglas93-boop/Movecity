const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    chatId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'chat',
        required: true
    },
    subjectType: {
        type: String,
        enum: ['ride', 'parcel'],
        default: 'ride',
    },
    subjectId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    // Compat com mensagens antigas / clientes que ainda leem rideId
    rideId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride',
        sparse: true,
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
    recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'recipientType'
    },
    recipientType: {
        type: String,
        enum: ['user', 'captain'],
        required: true
    },
    // Mensagens operacionais continuam no mesmo histórico, mas são identificadas para
    // auditoria e não dependem de inferir a palavra "PIN" no texto.
    operationalType: {
        type: String,
        enum: ['delivery_pin'],
        default: null
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

messageSchema.index({ chatId: 1, createdAt: 1 });
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

module.exports = mongoose.model('message', messageSchema);
