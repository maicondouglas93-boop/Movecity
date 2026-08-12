const mongoose = require('mongoose');

const accountDeletionRequestSchema = new mongoose.Schema({
    accountType: {
        type: String,
        enum: ['user', 'captain'],
        required: true,
        index: true,
    },
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true,
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
    },
    source: {
        type: String,
        enum: ['authenticated', 'web'],
        required: true,
    },
    status: {
        type: String,
        enum: ['pending_verification', 'scheduled', 'processing', 'completed', 'rejected', 'cancelled'],
        required: true,
        index: true,
    },
    requestedAt: {
        type: Date,
        default: Date.now,
    },
    processAfter: {
        type: Date,
        default: null,
        index: true,
    },
    completedAt: {
        type: Date,
        default: null,
    },
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'adminUser',
        default: null,
    },
    failureReason: {
        type: String,
        default: '',
    },
}, { timestamps: true });

accountDeletionRequestSchema.index({ status: 1, processAfter: 1 });
accountDeletionRequestSchema.index({ email: 1, accountType: 1, status: 1 });

module.exports = mongoose.model('AccountDeletionRequest', accountDeletionRequestSchema);
