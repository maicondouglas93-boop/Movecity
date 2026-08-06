const mongoose = require('mongoose');

/**
 * Singleton lógico — configuração da versão publicada do APK MoveCity Motorista.
 * O arquivo .apk NÃO fica no Mongo; só a URL (CDN/storage).
 */
const driverAppVersionSchema = new mongoose.Schema({
    version: { type: String, default: '1.1.0', trim: true },
    versionCode: { type: Number, default: 2, min: 1 },
    minimumVersion: { type: String, default: '1.0.0', trim: true },
    minimumVersionCode: { type: Number, default: 1, min: 1 },
    apkUrl: { type: String, default: '', trim: true },
    sha256: { type: String, default: '', trim: true },
    fileSize: { type: Number, default: 0, min: 0 },
    mandatory: { type: Boolean, default: false },
    releaseNotes: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('driverAppVersion', driverAppVersionSchema);
