const mongoose = require('mongoose');

/**
 * Auditoria de consultas às APIs de monitoramento dos fornecedores.
 * Nunca armazena API keys.
 */
const serviceMonitorAuditSchema = new mongoose.Schema({
    service: { type: String, required: true, index: true },
    operation: { type: String, required: true },
    statusCode: { type: Number },
    ok: { type: Boolean, default: false },
    latencyMs: { type: Number },
    error: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

serviceMonitorAuditSchema.index({ createdAt: -1 });
serviceMonitorAuditSchema.index({ service: 1, createdAt: -1 });

module.exports = mongoose.model('serviceMonitorAudit', serviceMonitorAuditSchema);
