const mongoose = require('mongoose');

/**
 * Snapshot cacheado do estado de um serviço externo.
 * Permite exibir o último dado válido quando a API do fornecedor falha.
 */
const serviceMonitorSnapshotSchema = new mongoose.Schema({
    service: {
        type: String,
        required: true,
        unique: true,
        enum: ['google_maps', 'firebase', 'mongodb', 'render', 'imagekit', 'backend'],
    },
    status: {
        type: String,
        enum: ['healthy', 'attention', 'critical', 'unknown', 'unavailable'],
        default: 'unknown',
    },
    plan: { type: String, default: '—' },
    usagePercent: { type: Number, default: null },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: { type: String, default: 'internal' }, // official | internal | hybrid | cached
    lastSuccessAt: { type: Date },
    lastError: { type: String },
    lastErrorAt: { type: Date },
    syncedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('serviceMonitorSnapshot', serviceMonitorSnapshotSchema);
