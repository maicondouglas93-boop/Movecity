const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    action: {
        type: String,
        required: true,
        enum: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT']
    },
    entity: {
        type: String,
        required: true, // ex: 'Promotion', 'Tariff', 'User'
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
    },
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'admin',
        required: true
    },
    details: {
        type: Object, // JSON com o "antes e depois" da mudança
    },
    ipAddress: {
        type: String,
    }
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ admin: 1 });
auditLogSchema.index({ entity: 1 });

module.exports = mongoose.model('auditLog', auditLogSchema);
