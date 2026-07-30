const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdminUser',
        required: true
    },
    adminName: {
        type: String,
        required: true
    },
    action: {
        type: String,
        required: true,
        // ex: "block_driver", "approve_driver", "update_tariff", "login"
    },
    targetId: {
        type: String,
        // The ID of the document being modified
    },
    targetModel: {
        type: String,
        // ex: "Captain", "User", "TariffSetting"
    },
    reason: {
        type: String,
    },
    oldValue: {
        type: mongoose.Schema.Types.Mixed
    },
    newValue: {
        type: mongoose.Schema.Types.Mixed
    },
    ipAddress: {
        type: String
    }
}, { timestamps: true });

const adminLogModel = mongoose.model('AdminLog', adminLogSchema);
module.exports = adminLogModel;
