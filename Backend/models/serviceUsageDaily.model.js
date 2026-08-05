const mongoose = require('mongoose');

/**
 * Contadores diários de uso por serviço/SKU (instrumentação interna + sync externo).
 * dayKey = YYYY-MM-DD (UTC).
 */
const serviceUsageDailySchema = new mongoose.Schema({
    service: {
        type: String,
        required: true,
        enum: ['google_maps', 'firebase', 'mongodb', 'render', 'imagekit', 'backend'],
        index: true,
    },
    sku: { type: String, required: true, index: true },
    dayKey: { type: String, required: true, index: true },
    requests: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    errorsByCode: {
        '403': { type: Number, default: 0 },
        '429': { type: Number, default: 0 },
        '500': { type: Number, default: 0 },
        other: { type: Number, default: 0 },
    },
    latencySumMs: { type: Number, default: 0 },
    latencyCount: { type: Number, default: 0 },
    // Distribuição horária (0–23) para picos de uso
    hourly: { type: [Number], default: () => Array(24).fill(0) },
    meta: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

serviceUsageDailySchema.index({ service: 1, sku: 1, dayKey: 1 }, { unique: true });

module.exports = mongoose.model('serviceUsageDaily', serviceUsageDailySchema);
