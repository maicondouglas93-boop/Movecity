const mongoose = require('mongoose');

/**
 * Auditoria de UX/produção (2026-08-10) — histórico append-only das publicações de
 * versão do APK motorista. driverAppVersion.model.js é um singleton que se
 * sobrescreve a cada PUT; sem isso não havia rollback real nem quem publicou o quê,
 * e a tela recorria a um bloco de texto fixo ("Valores v1.1.7") como referência
 * manual — que ficava desatualizado a cada novo release (produção já estava na
 * 1.1.16 quando isso foi corrigido).
 */
const driverAppVersionHistorySchema = new mongoose.Schema({
    version: { type: String, required: true },
    versionCode: { type: Number, required: true },
    minimumVersion: { type: String },
    minimumVersionCode: { type: Number },
    apkUrl: { type: String },
    sha256: { type: String },
    fileSize: { type: Number },
    mandatory: { type: Boolean },
    isActive: { type: Boolean },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
    adminName: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('driverAppVersionHistory', driverAppVersionHistorySchema);
