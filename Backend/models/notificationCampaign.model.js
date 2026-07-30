const mongoose = require('mongoose');

const notificationCampaignSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    message: {
        type: String,
        required: true
    },
    imageUrl: {
        type: String,
        default: ''
    },
    deepLink: {
        type: String,
        enum: ['home', 'wallet', 'promotions', 'rides', 'profile'],
        default: 'home'
    },
    type: {
        type: String,
        enum: ['marketing', 'system', 'promotion', 'emergency', 'financial', 'update'],
        default: 'marketing'
    },
    targetRules: {
        audienceType: { type: String, enum: ['all', 'passengers', 'drivers'], required: true },
        // Passenger specific filters
        isVIP: { type: Boolean },
        hasCoupon: { type: Boolean },
        noRidesDays: { type: Number },
        // Driver specific filters
        isOnline: { type: Boolean },
        vehicleType: { type: String },
        status: { type: String }, // 'active', 'inactive', 'in_review'
        // Common filters
        isBlocked: { type: Boolean },
        city: { type: String },
        state: { type: String }
    },
    status: {
        type: String,
        enum: ['draft', 'scheduled', 'processing', 'completed', 'failed', 'cancelled'],
        default: 'draft'
    },
    scheduledAt: {
        type: Date
    },
    metrics: {
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        opened: { type: Number, default: 0 },
        clicked: { type: Number, default: 0 }
    },
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdminUser'
    },
    errorLog: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model('NotificationCampaign', notificationCampaignSchema);
