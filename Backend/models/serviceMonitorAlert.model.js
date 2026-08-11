const mongoose = require('mongoose');

const serviceMonitorAlertSchema = new mongoose.Schema({
    service: { type: String, required: true, index: true },
    code: { type: String, required: true, index: true },
    severity: {
        type: String,
        enum: ['info', 'warning', 'critical'],
        default: 'warning',
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    threshold: { type: Number },
    value: { type: Number },
    acknowledged: { type: Boolean, default: false },
    acknowledgedAt: { type: Date },
    // Auditoria de UX/produção (2026-08-10): ack não registrava quem reconheceu o
    // alerta, só quando — sem autoria, impossível saber quem já viu/está cuidando.
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
    acknowledgedByName: { type: String },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date },
    fingerprint: { type: String, required: true, unique: true },
}, { timestamps: true });

serviceMonitorAlertSchema.index({ resolved: 1, createdAt: -1 });

module.exports = mongoose.model('serviceMonitorAlert', serviceMonitorAlertSchema);
