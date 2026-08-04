const mongoose = require('mongoose');

// Chamados da Central de Ajuda do passageiro (2026-08-04). Persistidos de verdade —
// a tela Help.jsx antes era só UI sem backend.
const supportTicketSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true,
        index: true,
    },
    category: {
        type: String,
        enum: [ 'ride_issue', 'lost_item', 'payment', 'other' ],
        required: true,
    },
    subject: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120,
    },
    message: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000,
    },
    rideId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ride',
    },
    status: {
        type: String,
        enum: [ 'open', 'in_progress', 'resolved', 'closed' ],
        default: 'open',
        index: true,
    },
}, { timestamps: true });

supportTicketSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('supportTicket', supportTicketSchema);
